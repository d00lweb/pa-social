// Installe le menu de commandes du bot et envoie les deux messages que le robot envoie vraiment,
// à l'identique : le kit X et la story Instagram. Rien n'est publié : npm run telegram:test
//
// Il n'y a pas d'exemple d'aperçu à valider : la publication est automatique sur les cinq réseaux
// (config/channels.json → telegram.previews = false). En envoyer un donnait à croire le contraire.
import { fetchItems } from '../src/sources/rss.mjs';
import { buildDossier } from '../src/brain/dossier.mjs';
import { loadMemory } from '../src/brain/memory.mjs';
import { prepare } from '../src/channels/instagram.mjs';
import { telegramEnabled, setCommands, sendStory, BOT_COMMANDS } from '../src/channels/telegram.mjs';

if (!telegramEnabled()) throw new Error('TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID requis dans .env');
await setCommands(BOT_COMMANDS);

const [article] = (await fetchItems(process.env.RSS_URL || 'https://passion-aquitaine.ouest-france.fr/feed/')).sort((a, b) => b.date - a.date);
const dossier = await buildDossier(article, { memory: await loadMemory(), useCache: true });
const pkg = await prepare(article, { dossier, log: () => {} });
// Kit X, à l'identique de l'envoi réel : image, texte à copier, comptes, lieu, description
const xkit = await import('../src/channels/x.mjs');
await xkit.publish(await xkit.prepare(article, { dossier, log: () => {} }));
console.log('Kit X d’exemple envoyé');

// Story Instagram, à l'identique elle aussi
await sendStory({
  buffer: pkg.files[0].buffer,
  url: article.link,
  title: article.title,
  link: article.link,
  comptes: (dossier.comptes?.instagram ?? []).map((c) => c.handle),
  lieu: dossier.lieuNom ?? dossier.commune ?? null,
});
console.log('Story d’exemple envoyée');
