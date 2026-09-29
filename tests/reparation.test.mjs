import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reparer } from '../src/brain/reparations.mjs';
import { checkDossier } from '../src/brain/guards.mjs';
import { rubriquesPermises } from '../src/brain/dossier.mjs';
import { placeNames } from '../src/brain/geo.mjs';

// Le 18/09/2026, un article est parti avec la description brute du flux sur cinq réseaux :
// l'IA avait répondu trois fois, refusée deux fois pour un surlignage trop long et une fois
// pour un point devant un emoji. Ces défauts se réparent ; ils ne doivent plus tout emporter.

const dossier = () => ({
  rubrique: 'Périgord',
  visuel: {
    titre: 'Grotte, rivière, châteaux : cette course de 80 km traverse l’histoire cachée du Périgord',
    surlignage: 'traverse l’histoire cachée du Périgord',
    description: 'Une course de 80 km.',
    texte_alternatif: 'Périgord : une course',
  },
  instagram: { texte: 'Une course de 80 km. 🏃', hashtags: ['#Périgord'] },
  facebook: { texte: 'Une course de 80 km 🏃' },
  bluesky: { texte: 'Une course de 80 km. 🏃', hashtag: '#Périgord' },
  threads: { texte: 'Une course de 80 km. 🏃', sujet: 'Périgord' },
  x: { texte: 'Une course de 80 km 🏃' },
});

test('surlignage trop long : recalculé au lieu de tout jeter', () => {
  const { repare, faits } = reparer(dossier(), ['surlignage trop long (3 mots et 24 caractères max)']);
  assert.ok(faits.includes('surlignage'));
  assert.notEqual(repare.visuel.surlignage, dossier().visuel.surlignage);
  assert.ok([...repare.visuel.surlignage].length <= 24, `« ${repare.visuel.surlignage} » tient dans la limite`);
  assert.ok(repare.visuel.titre.includes(repare.visuel.surlignage), 'copié exactement depuis le titre');
});

test('point avant un emoji : retiré sur tous les réseaux concernés', () => {
  const { repare, faits } = reparer(dossier(), ['threads : pas de point juste avant un emoji']);
  assert.ok(faits.includes('threads') && faits.includes('instagram') && faits.includes('bluesky'));
  for (const net of ['instagram', 'bluesky', 'threads']) {
    assert.doesNotMatch(repare[net].texte, /[.…]\s*\p{Extended_Pictographic}/u, `${net} nettoyé`);
    assert.match(repare[net].texte, /80 km 🏃$/u, `${net} garde son texte`);
  }
  assert.equal(repare.facebook.texte, dossier().facebook.texte, 'un texte déjà correct n’est pas touché');
});

test('les autres refus ne sont pas réparés : le repli reste la règle', () => {
  const { faits } = reparer(dossier(), ['instagram : chiffre absent de la source', 'x : formule d’appel à l’engagement interdite']);
  assert.equal(faits.length, 0, 'invention et appât ne se réparent pas mécaniquement');
});

// Emojis et hashtags, sur un vrai dossier (Opus 5.5, essai du 29/09/2026) abîmé comme les
// rédacteurs l'ont fait pendant les essais. Juge : les contrôles de production, avant et après.

const ed = JSON.parse(readFileSync(new URL('../config/editorial.json', import.meta.url), 'utf8'));
const reel = JSON.parse(readFileSync(new URL('./fixtures/dossier-hasparren.json', import.meta.url), 'utf8'));
const [TETE, PREMIERE_PHRASE, INFO_CLE, FIN] = ed.emojiPositions;
// Le placement tiré pour ce dossier, tel que ses textes le montrent : seul Bluesky ouvre sur l'emoji
const emojiPlacement = { instagram: INFO_CLE, facebook: FIN, bluesky: TETE, threads: PREMIERE_PHRASE, x: INFO_CLE };
const interne = new RegExp(ed.internalCategoryPattern, 'i');
const source = [reel.article.title, reel.article.description, reel.article.categories.filter((c) => !interne.test(c)).join(', ')].join('\n');
const controler = (d, recentEmojis = {}) => checkDossier(d, { ...ed, source, knownNames: [...ed.knownNames, ...placeNames(), ...ed.themes.map((t) => t.rubrique)], memory: {}, recentEmojis, emojiPlacement, rubriquesAutorisees: rubriquesPermises(reel.article) });
const contexte = (recentEmojis = {}) => ({ emojiPlacement, recentEmojis, sensitiveEmojis: ed.sensitiveEmojis, limits: ed.limits });
const copie = () => structuredClone(reel.dossier);
const lettres = (s) => (s.toLowerCase().match(/[\p{L}\p{N}]/gu) ?? []).join('');

// Défaut → refus des contrôles → réparation → les contrôles passent, sans qu'un mot ait bougé
function casReel(abimer, recentEmojis = {}) {
  const d = copie();
  abimer(d);
  const problemes = controler(d, recentEmojis);
  assert.ok(problemes.length, 'le défaut est bien refusé par les contrôles');
  const { repare, faits } = reparer(d, problemes, contexte(recentEmojis));
  assert.deepEqual(controler(repare, recentEmojis), [], 'le dossier réparé passe tous les contrôles');
  for (const net of ['instagram', 'facebook', 'bluesky', 'threads', 'x']) {
    assert.equal(lettres(repare[net].texte), lettres(d[net].texte), `${net} : aucun mot ni chiffre changé`);
  }
  return { d, problemes, repare, faits };
}

test('dossier réel : passe les contrôles tel quel', () => {
  assert.deepEqual(controler(copie()), []);
});

test('Bluesky sans emoji alors qu’il doit ouvrir le texte : un emoji du dossier est posé en tête', () => {
  // Poitiers, 29/09/2026 : Opus 5.5 a oublié l'emoji de Bluesky trois fois de suite, trois
  // appels payés, puis l'article est parti avec les règles de secours.
  const { problemes, repare, faits } = casReel((d) => {
    d.bluesky.texte = d.bluesky.texte.replace('🌱 ', '');
  });
  assert.match(problemes.join(' | '), /bluesky : au moins 1 emoji/);
  assert.ok(faits.includes('emoji bluesky'));
  assert.ok(repare.bluesky.texte.startsWith('🎓 Comment exister'), repare.bluesky.texte);
});

test('X ouvert par un emoji alors que ce post le veut ailleurs : l’emoji referme le texte', () => {
  const { repare, faits } = casReel((d) => {
    d.x.texte = `💶 ${d.x.texte.replace('💶 ', '')}`;
  });
  assert.ok(faits.includes('emoji x'));
  assert.ok(repare.x.texte.startsWith('Hasparren'), repare.x.texte);
  assert.ok(repare.x.texte.endsWith('de sa division 💶'), repare.x.texte);
});

test('Threads : emoji déjà vu dans les derniers posts, remplacé sur place par un autre du dossier', () => {
  // Levure et alcool, 23/09/2026 : 🍇 venait de servir sur Threads, un appel de plus.
  const { d, repare, faits } = casReel(() => {}, { threads: [['🏟']] });
  assert.ok(faits.includes('emoji threads'));
  assert.equal(repare.threads.texte, d.threads.texte.replace('🏟️', '🎓'));
});

test('Instagram sans emoji : un emoji du dossier clôt la première ligne', () => {
  // Course du Périgord, 23/09/2026 : Instagram sans emoji, un appel de plus.
  const { repare, faits } = casReel((d) => {
    d.instagram.texte = d.instagram.texte.replace('🎓 ', '');
  });
  assert.ok(faits.includes('emoji instagram'));
  const [premiere] = repare.instagram.texte.split('\n');
  assert.ok(premiere.endsWith('en interne 🏟️'), premiere);
});

test('hashtags écrits sans « # » : le « # » est rendu, rien d’autre', () => {
  // Sonnet 5.5, 29/09/2026 : « Hasparren », « Anglet », « Pau », « Poitiers » refusés, un appel chacun.
  const { repare, faits } = casReel((d) => {
    d.instagram.hashtags[0] = 'Hasparren';
    d.bluesky.hashtag = 'Hasparren';
  });
  assert.ok(faits.includes('hashtags'));
  assert.deepEqual(repare.instagram.hashtags, reel.dossier.instagram.hashtags);
  assert.equal(repare.bluesky.hashtag, '#Hasparren');
});

test('un emoji en milieu de phrase ne se déplace pas : on redemande à l’IA', () => {
  // Bluesky n'a droit qu'à un emoji, posé ici entre deux phrases : l'en retirer obligerait à
  // retoucher la ponctuation de la phrase qu'il sépare.
  const d = copie();
  d.bluesky.texte = d.bluesky.texte.replace('🌱 ', '').replace(/\?\s/u, (fin) => `${fin}🌱 `);
  assert.match(d.bluesky.texte, /division\s\? 🌱 À Hasparren/u);
  const problemes = controler(d);
  assert.match(problemes.join(' | '), /bluesky : emoji attendu en tête/);
  const { repare, faits } = reparer(d, problemes, contexte());
  assert.ok(!faits.includes('emoji bluesky'));
  assert.equal(repare.bluesky.texte, d.bluesky.texte);
});

test('jamais d’emoji à la place du point d’une abréviation, mais bien après un mot composé', () => {
  const d = copie();
  d.facebook.texte = 'Ici, le club forme ses joueurs comme on bâtissait en 52 av. J.-C.';
  const { repare, faits } = reparer(d, ['facebook : au moins 1 emoji (choisi selon le sujet)'], contexte());
  assert.ok(!faits.includes('emoji facebook'));
  assert.equal(repare.facebook.texte, d.facebook.texte);

  d.facebook.texte = 'Ici, le club forme ses joueurs à dix minutes du centre-ville.';
  const compose = reparer(d, ['facebook : au moins 1 emoji (choisi selon le sujet)'], contexte());
  assert.equal(compose.repare.facebook.texte, 'Ici, le club forme ses joueurs à dix minutes du centre-ville 🎓');
});

test('sujet sensible : seul un emoji sobre peut être posé', () => {
  const d = copie();
  d.sensible = true;
  d.instagram.texte = d.instagram.texte.replace('🎓', '📰');
  d.bluesky.texte = d.bluesky.texte.replace('🌱 ', '');
  const { repare, faits } = reparer(d, ['bluesky : au moins 1 emoji (choisi selon le sujet)', 'bluesky : emoji attendu en tête du texte'], contexte({ bluesky: [['📰']] }));
  assert.ok(faits.includes('emoji bluesky'));
  assert.ok(repare.bluesky.texte.startsWith('📍 '), repare.bluesky.texte);
});
