import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parametres } from '../src/channels/facebook.mjs';
import { fromRoot } from '../src/core/config.mjs';

const config = JSON.parse(readFileSync(fromRoot('config/channels.json'), 'utf8'));
const ed = JSON.parse(readFileSync(fromRoot('config/editorial.json'), 'utf8'));

// 23/09/2026 : les huit premières publications Facebook — visuel habillé, texte reprenant le titre,
// lien en premier commentaire — ont fait 0 réaction et 0 clic. Le format devient une publication
// avec lien : une phrase, puis la carte d'aperçu que Facebook fabrique depuis l'article.

test('Facebook : inactif tant que le jeton de Page manque', () => {
  const fb = config.channels.facebook;
  assert.deepEqual(fb.requiresEnv, ['FB_PAGE_ID', 'FB_TOKEN'], 'le canal reste hors ligne sans identifiants');
  assert.equal(fb.validation, false, 'publication automatique comme les autres réseaux');
});

test('Facebook : deux posts par jour au plus, un le matin, un en fin de journée, jamais la nuit', () => {
  const fb = config.channels.facebook;
  const h = (s) => { const [a, b] = s.split(':').map(Number); return a + b / 60; };
  const [[debutMatin, finMatin], [debutSoir, finSoir]] = fb.creneaux;
  assert.equal(fb.maxPerDay, 2);
  assert.ok(h(finMatin) <= 12 && h(debutSoir) >= 18, 'un créneau le matin, un en fin de journée');
  assert.ok(h(debutSoir) - h(finMatin) >= 3, 'toujours plus de 3 h entre deux posts Facebook');
  assert.equal(fb.quietHours.start, 22);
  assert.equal(fb.quietHours.end, 8);
  assert.ok(h(debutMatin) >= fb.quietHours.end && h(finSoir) <= fb.quietHours.start, 'aucun créneau pendant la nuit');
  assert.equal(fb.commentDelayMinutes, undefined, 'plus de lien en commentaire : il est dans la carte d’aperçu');
});

test('Facebook : le lien part avec le post, et le lieu quand il est connu', () => {
  const pkg = { text: 'Une phrase qui donne envie de cliquer 🐬', lien: 'https://site.fr/a', lieu: { id: '123', nom: 'Hossegor' } };
  assert.deepEqual(parametres(pkg), { message: pkg.text, link: 'https://site.fr/a', published: 'true', place: '123' });
  assert.equal(parametres({ ...pkg, lieu: null }).place, undefined, 'sans lieu, aucun paramètre de lieu');
});

test('Facebook : une seule phrase courte, un seul emoji', () => {
  assert.equal(ed.limits.facebook, 140, 'l’essentiel reste visible avant « Voir plus »');
  assert.deepEqual(ed.limits.emoji.facebook, [1, 1], 'un emoji, choisi pour le sujet');
  const consigne = readFileSync(fromRoot('prompts/editorial.md'), 'utf8').match(/- `facebook\.texte` :.*/)[0];
  assert.match(consigne, /sans aucun retour à la ligne/);
  assert.match(consigne, /donner envie de cliquer/);
  assert.match(consigne, /uniquement si `questions_autorisees\.facebook` est vrai/, 'la question n’est pas systématique');
});

test('Facebook : un retour à la ligne est refusé par les contrôles', async () => {
  const { checkDossier } = await import('../src/brain/guards.mjs');
  const source = 'Pourquoi Bordeaux parle désormais de « matrimoine »\nLe mot matrimoine, plus vieux que patrimoine, resurgit à Bordeaux.\nBordeaux, Culture';
  const dossier = (texte) => ({
    nature: 'evergreen', sensible: false, rubrique: 'Bordeaux',
    visuel: { titre: 'Pourquoi Bordeaux parle désormais de « matrimoine »', surlignage: 'matrimoine', description: 'Plus ancien que patrimoine, le matrimoine revient à Bordeaux, porté par les festivals.', texte_alternatif: 'Bordeaux : pourquoi la ville parle de matrimoine' },
    instagram: { texte: 'Un mot plus vieux que patrimoine refait surface 👀\nÀ Bordeaux, festivals et histoire lui redonnent vie.', hashtags: ['#Bordeaux', '#Matrimoine', '#Histoire'] },
    facebook: { texte },
    bluesky: { texte: 'Plus ancien que « patrimoine », le mot matrimoine resurgit depuis plusieurs années dans la vie culturelle bordelaise 🏛️ Origine et usages.', hashtag: '#Bordeaux' },
    threads: { texte: 'On parle beaucoup de patrimoine. Et si son jumeau oublié revenait ? 🎭 À Bordeaux, les festivals remettent le matrimoine au centre.', sujet: 'Bordeaux' },
    x: { texte: 'Matrimoine : le mot oublié que Bordeaux remet à l’honneur 🎭' },
  });
  const ctx = { ...ed, source, knownNames: ed.knownNames };
  const dUneLigne = 'Le matrimoine, plus vieux que le patrimoine, revient dans les festivals bordelais 🎭';
  assert.ok(!checkDossier(dossier(dUneLigne), ctx).some((p) => p.includes('retour à la ligne')), 'une phrase d’un bloc passe');
  assert.ok(checkDossier(dossier(`${dUneLigne}\nOrigine et usages.`), ctx).some((p) => p.includes('retour à la ligne')), 'deux lignes sont refusées');
});

test('Facebook sans IA : le repli n’est plus le titre, et l’emoji n’est pas posé au hasard', async () => {
  const { fallbackDossier, accrocheFacebook } = await import('../src/brain/fallback.mjs');
  // 23/09/2026 : « 200 danseurs pour un French Cancan géant sur le Miroir d’Eau 📍 » — le titre,
  // que la carte d’aperçu affiche déjà juste en dessous, avec un emoji passe-partout.
  const article = {
    title: 'À Bordeaux, 200 danseurs pour un French Cancan géant sur le Miroir d’Eau',
    description: 'Le 30 septembre 2026, plus de 200 danseurs tentent un record du monde de French Cancan sur le Miroir d’eau de Bordeaux.',
    categories: ['Bordeaux'], link: 'https://site.fr/a', guid: 'g', date: Date.now(),
  };
  const texte = fallbackDossier(article).facebook.texte;
  assert.notEqual(texte.replace(/\s\p{Extended_Pictographic}$/u, ''), article.title, 'le texte ne redit pas le titre');
  assert.ok([...texte].length <= ed.limits.facebook, `${[...texte].length} caractères`);
  assert.doesNotMatch(texte, /[\r\n]/, 'une seule phrase');
  assert.match(texte, /💃$/, 'emoji du sujet : des danseuses, pas le trophée du record');

  // la phrase retenue est celle qui accroche, pas forcément la première
  const accroche = accrocheFacebook({
    titre: 'Ces dauphins ne sont pas bon signe',
    description: 'Les dauphins émerveillent les promeneurs. Une biologiste marine y voit pourtant un signal d’alerte.',
    emoji: null, max: 140,
  });
  assert.match(accroche, /pourtant/, 'le renversement l’emporte sur la première phrase');
  assert.doesNotMatch(accroche, /\p{Extended_Pictographic}/u, 'sans thème reconnu, pas d’emoji plutôt qu’un emoji creux');
});

test('Facebook : aucune date dans le texte, et l’emoji colle au sujet', async () => {
  const { sansDate, emojiPour } = await import('../src/brain/fallback.mjs');
  // « Le 30 septembre 2026, plus de 200 danseurs… » ouvre sur l'information la moins engageante
  assert.equal(sansDate('Le 30 septembre 2026, plus de 200 danseurs tentent un record.'), 'Plus de 200 danseurs tentent un record.');
  assert.equal(sansDate('À partir du 3 octobre, le musée ouvre la nuit.'), 'Le musée ouvre la nuit.');
  assert.equal(sansDate('Dès le 4 mai, les navettes reprennent.'), 'Les navettes reprennent.');
  assert.equal(sansDate('Depuis 2019, la fréquentation a doublé.'), 'La fréquentation a doublé.');
  // les nombres qui font l'intérêt restent, et « mai » ne doit pas manger « mais »
  assert.equal(sansDate('Son brunch passe à 29 euros, mais la formule reste la même.'), 'Son brunch passe à 29 euros, mais la formule reste la même.');
  assert.equal(sansDate('Le musée du Louvre ouvre le samedi.'), 'Le musée du Louvre ouvre le samedi.');

  // l'emoji suit le sujet, pas l'événement : des danseuses plutôt qu'un trophée
  assert.equal(emojiPour({ title: 'French Cancan géant', description: '200 danseurs tentent un record du monde' }), '💃');
  assert.equal(emojiPour({ title: 'Ces dauphins ne sont pas bon signe', description: 'une biologiste alerte' }), '🐬');
  assert.equal(emojiPour({ title: 'Le brunch le plus généreux', description: 'à volonté' }), '🥐');
  assert.equal(emojiPour({ title: 'Un sujet sans mot connu', description: 'rien de reconnaissable' }), null, 'aucun emoji plutôt qu’un emoji creux');
});
