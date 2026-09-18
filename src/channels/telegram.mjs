const API = 'https://api.telegram.org';

function config() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  return token && chat ? { token, chat } : null;
}

export const telegramEnabled = () => Boolean(config());

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

// Message HTML ; extra : reply_markup (JSON), reply_to_message_id…
export async function send(text, extra = {}) {
  const c = config();
  if (!c) {
    console.log(text);
    return null;
  }
  return call('sendMessage', new URLSearchParams({ chat_id: c.chat, text, parse_mode: 'HTML', disable_web_page_preview: 'true', ...extra }));
}

export async function sendPhotos(buffers) {
  const c = config();
  if (!c || !buffers.length) return null;
  const form = new FormData();
  form.append('chat_id', c.chat);
  form.append('media', JSON.stringify(buffers.map((_, i) => ({ type: 'photo', media: `attach://p${i}` }))));
  buffers.forEach((buffer, i) => form.append(`p${i}`, new Blob([buffer], { type: 'image/jpeg' }), `visuel-${i + 1}.jpg`));
  return call('sendMediaGroup', form);
}

export async function getUpdates(offset) {
  return call('getUpdates', new URLSearchParams({ offset: String(offset), timeout: '0', allowed_updates: JSON.stringify(['message', 'callback_query']) }));
}

// Les réponses aux boutons expirent vite côté Telegram : échecs ignorés
export async function answerCallback(id, text) {
  try {
    await call('answerCallbackQuery', new URLSearchParams({ callback_query_id: id, text }));
  } catch {
    // trop ancien
  }
}

export async function clearButtons(messageId) {
  const c = config();
  if (!c || !messageId) return;
  try {
    await call('editMessageReplyMarkup', new URLSearchParams({ chat_id: c.chat, message_id: String(messageId), reply_markup: JSON.stringify({ inline_keyboard: [] }) }));
  } catch {
    // déjà modifié
  }
}

export async function setCommands(commands) {
  if (!config()) return;
  await call('setMyCommands', new URLSearchParams({ commands: JSON.stringify(commands) }));
}

// Image envoyée en fichier (qualité d'origine, à enregistrer puis joindre au post)
export async function sendDocument(buffer, filename, caption = '') {
  const c = config();
  if (!c) return null;
  const form = new FormData();
  form.append('chat_id', c.chat);
  if (caption) form.append('caption', caption);
  form.append('document', new Blob([buffer], { type: 'image/jpeg' }), filename);
  return call('sendDocument', form);
}

// Story envoyée en document (pas de recompression) : le sticker lien se pose à la main
export async function sendStory({ buffer, url, title, link, comptes = [], lieu = null }) {
  const c = config();
  if (!c) {
    console.log(`Story à poster à la main : ${url}\n  Sticker lien : ${link}`);
    return;
  }
  const form = new FormData();
  form.append('chat_id', c.chat);
  form.append('caption', `📲 Story à poster\n${title}`);
  form.append('document', new Blob([buffer], { type: 'image/jpeg' }), 'story.jpg');
  await call('sendDocument', form);

  // un message par élément : chacun se copie d'une seule touche.
  // Le lien part seul, sans rien autour, pour être copié d'un geste dans le sticker.
  await send(`<code>${link}</code>`);
  for (const h of comptes) await send(`👤 <b>Compte à mentionner</b>\n<code>@${h}</code>`);
  if (lieu) await send(`📍 <b>Lieu à taguer</b>\n<code>${lieu}</code>`);
}

export const BOT_COMMANDS = [
  { command: 'statut', description: 'État des réseaux et de la file' },
  { command: 'file', description: 'Posts à valider et programmés' },
  { command: 'pause', description: 'Mettre un réseau en pause : /pause instagram (ou tout)' },
  { command: 'reprise', description: 'Reprendre un réseau : /reprise instagram (ou tout)' },
  { command: 'validation', description: 'Validation manuelle : /validation instagram on|off' },
  { command: 'aide', description: 'Liste des commandes' },
];
