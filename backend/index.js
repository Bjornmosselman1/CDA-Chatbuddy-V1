import express from 'express';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import compression from 'compression';
import path from 'path';
import { fileURLToPath } from 'url';
dotenv.config();

// __dirname setup for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Enable GZIP compression for faster response times
const app = express();
app.use(compression());
app.use(express.json());
// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '../public'), { maxAge: '1d' }));

// SPA fallback: serve index.html for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });

app.post('/chat', async (req, res) => {
  const { session_id, message } = req.body;
  // 1) user-embedding
  const embeddingResp = await openai.embeddings.create({
    model: 'text-embedding-ada-002',
    input: message
  });
  const userEmb = embeddingResp.data[0].embedding;
  // 2) top-5 relevante chunks
  const { data: hits, error: rpcError } = await supabase.rpc('vector_search', {
    query_embedding: userEmb,
    match_count: 5
  });
  if (rpcError) {
    console.error('vector_search error:', rpcError);
    return res.status(500).json({ reply: 'Er is een interne fout bij het zoeken in de database.' });
  }
  console.log('vector_search hits:', hits);
  // Fallback als er geen relevante kennisitems zijn
  if (!hits || hits.length === 0) {
    return res.json({ reply: 'Ik heb geen antwoord op deze vraag.' });
  }
  const context = hits.map(h => h.content).join('\n---\n');
  // 3) chat met context
  const chat = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'Je bent strikt retrieval-only. Gebruik alleen de volgende bronnen om te antwoorden. Als de informatie ontbreekt, antwoord dan exact: "Ik heb geen antwoord op deze vraag".' },
      { role: 'system',   content: 'Je bent CDA-chatbot met eigen documenten.' },
      { role: 'system', content: 'Antwoord als een CDA’er: gebruik korte paragrafen van maximaal 3–4 zinnen en een warme, inhoudelijke christendemocratische toon.' },
      { role: 'system',   content: `Bronnen:\n${context}` },
      { role: 'user',     content: message }
    ]
  });
  const reply = chat.choices[0].message.content;
  // 4) loggen (optioneel)
  await supabase.from('chat_messages').insert([
    { session_id, role: 'user',    content: message },
    { session_id, role: 'assistant', content: reply }
  ]);
  res.json({ reply });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server draait op http://localhost:${port}`));