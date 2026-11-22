// Installe le menu de commandes du bot et envoie les deux « À faire » que le robot envoie vraiment,
// à l'identique : le kit X et la story Instagram, un message chacun. Rien n'est publié, rien n'est
// noté dans l'état : npm run telegram:test
//
// Il n'y a pas d'exemple d'aperçu à valider : la publication est automatique sur les cinq réseaux
// (config/channels.json → telegram.previews = false). En envoyer un donnait à croire le contraire.
import { fetchItems } from '../src/sources/rss.mjs';
import { buildDossier } from '../src/brain/dossier.mjs';
import { loadMemory } from '../src/brain/memory.mjs';
import { prepare } from '../src/channels/instagram.mjs';
import { kitX, story } from '../src/channels/messages.mjs';
import { telegramEnabled, setCommands, sendDocument, BOT_COMMANDS } from '../src/channels/telegram.mjs';

if (!telegramEnabled()) throw new Error('TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID requis dans .env');
await setCommands(BOT_COMMANDS);

const [article] = (await fetchItems(process.env.RSS_URL || 'https://passion-aquitaine.ouest-france.fr/feed/')).sort((a, b) => b.date - a.date);
const dossier = await buildDossier(article, { memory: await loadMemory(), useCache: true });
const pkg = await prepare(article, { dossier, log: () => {} });

// Kit X : le même message que l'envoi réel, sans la marque « déjà envoyé » de l'état
const xkit = await import('../src/channels/x.mjs');
const xpkg = await xkit.prepare(article, { dossier, log: () => {} });
const kit = kitX(xkit.kitDonnees(xpkg));
await sendDocument(xpkg.files[0].buffer, xpkg.files[0].name, { caption: kit.text, reply_markup: kit.reply_markup });
console.log('Kit X d’exemple envoyé');

// Story Instagram, à l'identique elle aussi
const s = story({ titre: article.title, lienArticle: article.link, comptes: (dossier.comptes?.instagram ?? []).map((c) => c.handle), lieu: dossier.lieuNom ?? dossier.commune ?? null });
await sendDocument(pkg.files[2].buffer, 'story.jpg', { caption: s.text, reply_markup: s.reply_markup });
console.log('Story d’exemple envoyée');
