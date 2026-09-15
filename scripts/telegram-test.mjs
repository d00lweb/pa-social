// Installe le menu de commandes du bot et envoie un aperçu d'exemple (dernier article) : npm run telegram:test
// Les boutons de cet exemple ne déclenchent rien (réponse « Déjà traité »).
import { fetchItems } from '../src/sources/rss.mjs';
import { buildDossier } from '../src/brain/dossier.mjs';
import { loadMemory } from '../src/brain/memory.mjs';
import { prepare } from '../src/channels/instagram.mjs';
import { telegramEnabled, setCommands, send, sendPhotos, BOT_COMMANDS } from '../src/channels/telegram.mjs';
import { buildPreviewText, previewButtons } from '../src/channels/preview.mjs';

if (!telegramEnabled()) throw new Error('TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID requis dans .env');
await setCommands(BOT_COMMANDS);

const [article] = (await fetchItems(process.env.RSS_URL || 'https://passion-aquitaine.ouest-france.fr/feed/')).sort((a, b) => b.date - a.date);
const dossier = await buildDossier(article, { memory: await loadMemory(), useCache: true });
const pkg = await prepare(article, { dossier, log: () => {} });
const items = [{ channel: 'instagram', status: 'awaiting', dueAt: Date.now() + 2 * 3600e3 }];
await sendPhotos([pkg.files[0].buffer, pkg.files[1].buffer]);
await send(`🧪 <b>Exemple d'aperçu</b> (test, rien ne sera publié)\n\n${buildPreviewText({ article, dossier, caption: pkg.caption, items, when: () => 'vers 14h30' })}`, {
  reply_markup: JSON.stringify({ inline_keyboard: previewButtons('exemple', true) }),
});
console.log(`Aperçu d'exemple envoyé : ${article.title}`);

// Exemple de kit X, identique à l'envoi réel
const xkit = await import('../src/channels/x.mjs');
await send('🧪 <b>Exemple de kit X</b> (test)');
await xkit.publish(await xkit.prepare(article, { dossier, log: () => {} }));
console.log('Kit X d’exemple envoyé');
