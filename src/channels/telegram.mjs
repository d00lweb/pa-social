import { notificationActive } from './messages.mjs';

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

// Balises interprétées par Telegram ; tout le reste doit être échappé à l'écriture du message.
const sansBalises = (t) => String(t).replace(/<\/?(?:b|i|u|s|code|pre|a|blockquote)(?:\s[^>]*)?>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// Envoi HTML, avec repli en texte nu si Telegram refuse le balisage. Sans ce repli, un message
// mal formé (une esperluette oubliée dans un titre) ne partirait pas du tout.
async function envoyer(text, extra = {}) {
  const c = config();
  const base = { chat_id: c.chat, disable_web_page_preview: 'true', ...extra };
  try {
    return await call('sendMessage', new URLSearchParams({ ...base, text, parse_mode: 'HTML' }));
  } catch (e) {
    if (!/parse|entit|tag/i.test(e.message)) throw e;
    console.error(`Telegram : balisage refusé (${e.message}), envoi en texte nu`);
    return call('sendMessage', new URLSearchParams({ ...base, text: sansBalises(text) }));
  }
}

// Message HTML ; extra : reply_markup (JSON), reply_to_message_id…
export async function send(text, extra = {}, { type = null } = {}) {
  const c = config();
  if (!c) {
    console.log(sansBalises(text));
    return null;
  }
  if (type && !notificationActive(type)) {
    console.log(`   (message Telegram « ${type} » coupé dans les réglages)`);
    return null;
  }
  return envoyer(text, extra);
}

// Un message du gabarit ({ text, reply_markup }, src/channels/messages.mjs)
export const envoyerMessage = (message, options = {}) => send(message.text, message.reply_markup ? { reply_markup: message.reply_markup } : {}, options);

// Corrige en place un message déjà envoyé (un problème qui s'étend à un autre réseau)
export async function editText(messageId, message) {
  const c = config();
  if (!c || !messageId) return null;
  const base = { chat_id: c.chat, message_id: String(messageId), disable_web_page_preview: 'true', ...(message.reply_markup ? { reply_markup: message.reply_markup } : {}) };
  try {
    return await call('editMessageText', new URLSearchParams({ ...base, text: message.text, parse_mode: 'HTML' }));
  } catch (e) {
    if (/not modified/i.test(e.message)) return null;
    throw e;
  }
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

// Image envoyée en fichier (qualité d'origine, à enregistrer puis joindre au post), avec sa légende
// HTML et ses boutons : un « À faire » tient ainsi en un seul message. Repli en texte nu si Telegram
// refuse le balisage, comme pour les messages.
export async function sendDocument(buffer, filename, { caption = '', reply_markup = null } = {}) {
  const c = config();
  if (!c) {
    console.log(sansBalises(caption));
    return null;
  }
  const form = (html) => {
    const f = new FormData();
    f.append('chat_id', c.chat);
    if (caption) f.append('caption', html ? caption : sansBalises(caption));
    if (caption && html) f.append('parse_mode', 'HTML');
    if (reply_markup) f.append('reply_markup', reply_markup);
    f.append('document', new Blob([buffer], { type: 'image/jpeg' }), filename);
    return f;
  };
  try {
    return await call('sendDocument', form(true));
  } catch (e) {
    if (!/parse|entit|tag/i.test(e.message)) throw e;
    console.error(`Telegram : balisage refusé (${e.message}), légende en texte nu`);
    return call('sendDocument', form(false));
  }
}

export const BOT_COMMANDS = [
  { command: 'statut', description: 'État des réseaux et de la file' },
  { command: 'file', description: 'Posts à valider et programmés' },
  { command: 'pause', description: 'Mettre un réseau en pause : /pause instagram (ou tout)' },
  { command: 'reprise', description: 'Reprendre un réseau : /reprise instagram (ou tout)' },
  { command: 'validation', description: 'Validation manuelle : /validation instagram on|off' },
  { command: 'x', description: 'Abonnés X du jour : /x 2940' },
  { command: 'compte', description: 'Enseigner un compte : /compte Hendaye @villehendaye64700' },
  { command: 'jamais', description: 'Ne plus taguer un compte : /jamais @compte' },
  { command: 'oublier', description: 'Défaire : /oublier Hendaye ou /oublier @compte' },
  { command: 'comptes', description: 'Comptes enseignés et exclus' },
  { command: 'aide', description: 'Ce que je t’envoie, et les commandes' },
];
