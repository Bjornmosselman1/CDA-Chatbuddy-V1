import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'raw-documents';

console.log('🔧 Debug ENV →', {
  supabaseUrl,
  supabaseKey: supabaseKey?.substring(0, 10) + '…',
  BUCKET
});

if (!supabaseUrl || !supabaseKey) {
  console.error('❗️ SUPABASE_URL of SUPABASE_SERVICE_ROLE_KEY niet gevonden in .env');
  process.exit(1);
}
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import mammoth from 'mammoth';
function splitIntoChunks(text, maxLength = 1000) {
  const chunks = [];
  for (let i = 0; i < text.length; i += maxLength) {
    chunks.push(text.slice(i, i + maxLength));
  }
  return chunks;
}

const supabase = createClient(supabaseUrl, supabaseKey);
const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });

// 1) lijst bestanden
async function listDocs() {
  // List files in the bucket root
  const { data, error } = await supabase
    .storage
    .from(BUCKET)
    .list('', { limit: 1000 });
  console.log('🔧 Debug listDocs → error:', error, 'data:', data);
  if (error) {
    console.error('‼️ Error listing documents:', error);
    return [];
  }

  return data.map(file => file.name);
}

async function downloadText(p) {
  const { data } = await supabase.storage.from(BUCKET).download(p);
  const buffer = Buffer.from(await data.arrayBuffer());
  if (p.endsWith('.pdf')) {
    const uint8 = new Uint8Array(buffer);
    const pdf = await getDocument({ data: uint8 }).promise;
    let fullText = '';
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      fullText += content.items.map(item => item.str).join(' ') + '\n';
    }
    return fullText;
  }
  if (p.match(/\.docx?$/)) {
    return (await mammoth.extractRawText({ buffer })).value;
  }
  return buffer.toString();
}

(async () => {
  // Debug: list all buckets to verify bucket name
  const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
  if (bucketsError) {
    console.error('‼️ Error fetching buckets:', bucketsError);
  } else {
    console.log('🔧 Debug Buckets →', buckets.map(b => b.name));
  }
  const paths = await listDocs();
  console.log('⚙️  Found files in bucket:', paths);
  if (paths.length === 0) {
    console.error('‼️  Geen documenten gevonden! Check je bucket-naam en pad.');
    return;
  }
  for (const p of paths) {
    console.log(`⏳ Processing ${p}…`);
    const txt = await downloadText(p);
    const meta = { source: p, at: new Date().toISOString() };
    const chunks = splitIntoChunks(txt);
    console.log(`  → ${chunks.length} chunks`);
    let inserted = 0;
    for (const [i, chunkText] of chunks.entries()) {
      const embeddingResp = await openai.embeddings.create({
        model: 'text-embedding-ada-002',
        input: chunkText
      });
      const embedding = embeddingResp.data[0].embedding;
      const { error } = await supabase.from('knowledge_items').insert([{
        title: path.basename(p),
        content: chunkText,
        metadata: { ...meta, chunk_index: i },
        embedding
      }]);
      if (!error) inserted++;
    }
    console.log(`  ✔️ Ingested ${inserted}/${chunks.length} chunks for ${p}`);
  }
  console.log('Ingestie klaar.');
})();