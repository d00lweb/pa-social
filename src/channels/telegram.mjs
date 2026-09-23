import { aCopier } from './messages.mjs';

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

// Alerte : même rendu que les autres messages. Elle passait auparavant sans parse_mode, ce qui
// affichait « <b>Budget IA</b> » en clair dans Telegram.
export async function alert(text) {
  console.error(sansBalises(text));
  const c = config();
  if (!c) return;
  await envoyer(text);
}

// Message HTML ; extra : reply_markup (JSON), reply_to_message_id…
export async function send(text, extra = {}) {
  const c = config();
  if (!c) {
    console.log(sansBalises(text));
    return null;
  }
  return envoyer(text, extra);
}

// Élément à copier : le message ne porte que la valeur, l'étiquette est sur le bouton.
export async function sendCopie(etiquette, valeur, options = {}) {
  const { text, options: extra } = aCopier(etiquette, valeur, options);
  return send(text, extra);
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

  // Un message par élément, et chaque message ne contient que ce qu'il faut copier : l'étiquette
  // est portée par le bouton. Copier le message entier donne donc exactement la valeur, sans
  // titre à effacer ensuite — et sans la ligne vide que cet effacement laissait derrière lui.
  await sendCopie('Copier le lien du sticker', link);
  for (const h of comptes) await sendCopie(`Copier @${h}`, `@${h}`);
  if (lieu) await sendCopie('Copier le lieu à taguer', lieu);
}

export const BOT_COMMANDS = [
  { command: 'statut', description: 'État des réseaux et de la file' },
  { command: 'file', description: 'Posts à valider et programmés' },
  { command: 'pause', description: 'Mettre un réseau en pause : /pause instagram (ou tout)' },
  { command: 'reprise', description: 'Reprendre un réseau : /reprise instagram (ou tout)' },
  { command: 'validation', description: 'Validation manuelle : /validation instagram on|off' },
  { command: 'x', description: 'Abonnés X du jour : /x 2940' },
  { command: 'aide', description: 'Liste des commandes' },
];
