const API = 'https://api.telegram.org';

function config() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  return token && chat ? { token, chat } : null;
}

async function call(method, body) {
  const { token } = config();
  const res = await fetch(`${API}/bot${token}/${method}`, { method: 'POST', body });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`Telegram ${method} : ${json.description ?? res.status}`);
  return json.result;
}

export async function alert(text) {
  console.error(text);
  const c = config();
  if (!c) return;
  await call('sendMessage', new URLSearchParams({ chat_id: c.chat, text, disable_web_page_preview: 'true' }));
}

// Story envoyée en document (pas de recompression) : le sticker lien se pose à la main
export async function sendStory({ buffer, url, title, link }) {
  const c = config();
  if (!c) {
    console.log(`Story à poster à la main : ${url}\n  Sticker lien : ${link}`);
    return;
  }
  const form = new FormData();
  form.append('chat_id', c.chat);
  form.append('caption', `📲 Story à poster\n${title}\n\n🔗 Sticker lien : ${link}`);
  form.append('document', new Blob([buffer], { type: 'image/jpeg' }), 'story.jpg');
  await call('sendDocument', form);
}
