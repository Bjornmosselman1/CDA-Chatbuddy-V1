
const form  = document.getElementById('chat-form');
const input = document.getElementById('user-input');
const box   = document.getElementById('chat-box');
const typingIndicator = document.getElementById('typing-indicator');

form.addEventListener('submit', async e => {
  e.preventDefault();
  const userMessage = input.value.trim();
  if (!userMessage) return;

  appendMessage('Jij', userMessage, 'user');
  input.value = '';
  typingIndicator.classList.remove('hidden');

  const response = await fetch('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: 'sessie123', message: userMessage })
  });
  const data  = await response.json();
  const reply = data.reply || 'Er ging iets mis.';
  typingIndicator.classList.add('hidden');

  appendMessage('CDA Bot', reply, 'bot');
});

function appendMessage(sender, text, cls) {
  const msg = document.createElement('div');
  msg.className = `message ${cls}`;
  msg.innerHTML = `<strong>${sender}:</strong> ${text}`;
  box.appendChild(msg);
  box.scrollTop = box.scrollHeight;
}