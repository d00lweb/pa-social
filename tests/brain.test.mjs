import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findZone, resolvePlace } from '../src/brain/geo.mjs';
import { checkDossier, similarity } from '../src/brain/guards.mjs';
import { nextAngles, remember } from '../src/brain/memory.mjs';

const ed = JSON.parse(readFileSync(new URL('../config/editorial.json', import.meta.url), 'utf8'));

test('lexique géographique : identité locale', () => {
  assert.equal(findZone('À Ustaritz, dans le Pays basque, le centre soigne des animaux')?.name, 'Pays basque');
  assert.equal(findZone('À Loubieng, on dort suspendu entre les pins')?.name, 'Béarn');
  assert.equal(findZone('Cette boulangerie rochelaise')?.name, 'La Rochelle');
  assert.equal(findZone('Une forêt près de chez vous'), null);
  assert.equal(resolvePlace({ title: 'Un record', description: 'À Biarritz, la vague…', categories: ['Pyrénées-Atlantiques'] })?.name, 'Pays basque');
});

const source = 'Pourquoi Bordeaux parle désormais de « matrimoine »\nLe mot matrimoine, plus vieux que patrimoine, resurgit à Bordeaux depuis plusieurs années. Origine, histoire et festivals.\nBordeaux, Culture & traditions';
const good = () => ({
  nature: 'evergreen',
  sensible: false,
  rubrique: 'Bordeaux',
  visuel: { titre: 'Pourquoi Bordeaux parle désormais de « matrimoine »', surlignage: 'matrimoine', description: 'Plus ancien que patrimoine, le matrimoine revient à Bordeaux, porté par les festivals.', texte_alternatif: 'Bordeaux : pourquoi la ville parle de matrimoine' },
  instagram: { texte: 'Un mot plus vieux que patrimoine refait surface 👀\nÀ Bordeaux, festivals et histoire lui redonnent vie.', hashtags: ['#Bordeaux', '#Matrimoine', '#Histoire'] },
  facebook: { texte: 'Vous connaissiez le matrimoine ? Ce terme ancien revient dans les festivals bordelais 🎭' },
  bluesky: { texte: 'Plus ancien que « patrimoine », le mot matrimoine resurgit depuis plusieurs années dans la vie culturelle bordelaise 🏛️ Origine et usages.' },
  threads: { texte: 'On parle beaucoup de patrimoine. Et si son jumeau oublié revenait ? 🎭 À Bordeaux, les festivals remettent le matrimoine au centre.', sujet: 'Bordeaux' },
  x: { texte: 'Matrimoine : le mot oublié que Bordeaux remet à l’honneur 🎭' },
});
const ctx = { ...ed, source, knownNames: ed.knownNames };

test('contrôles : un dossier correct passe', () => {
  const d = good();
  d.bluesky.hashtag = '#Bordeaux';
  assert.deepEqual(checkDossier(d, ctx), []);
});

test('contrôles : les défauts connus sont refusés', () => {
  const cases = [
    [(d) => { d.visuel.surlignage = 'de plus'; d.visuel.titre = 'Vos courses coûtent 21 euros de plus'; }, /petit mot|absent/],
    [(d) => { d.visuel.surlignage = 'an'; d.visuel.titre = 'Le centre soigne des animaux par an'; }, /petit mot|trop faible/],
    [(d) => { d.rubrique = 'Actus'; }, /générique/],
    [(d) => { d.rubrique = 'Charente MA LOI'; }, /générique/],
    [(d) => { d.facebook.texte = 'Plus de 3 000 visiteurs attendus à Bordeaux.'; }, /chiffre absent/],
    [(d) => { d.x.texte = 'Le maire Dupontel relance le matrimoine.'; }, /nom propre absent/],
    [(d) => { d.instagram.hashtags = ['#Bordeaux', '#Histoire']; }, /exactement 3/],
    [(d) => { d.sensible = true; d.facebook.texte = 'Un drame bouleverse Bordeaux 😢'; }, /emoji/],
    [(d) => { d.threads.texte = d.facebook.texte; }, /mêmes tournures/],
    [(d) => { d.facebook.texte = `${d.facebook.texte} Un rendez-vous culturel à ne pas manquer cette saison.`; }, /facebook : \d+ caractères/],
    [(d) => { d.x.texte = 'Le matrimoine revient à Bordeaux #Bordeaux'; }, /hashtag dans le texte/],
    [(d) => { d.facebook.texte = 'Le matrimoine revient 🎭✨🎉'; }, /emoji/],
    [(d) => { d.visuel.description = 'x'.repeat(230); }, /2ᵉ image/],
    [(d) => { d.threads.sujet = 'Bordeaux & Co.'; }, /sujet Threads/],
  ];
  for (const [mutate, expected] of cases) {
    const d = good();
    d.bluesky.hashtag = '#Bordeaux';
    mutate(d);
    const problems = checkDossier(d, ctx).join(' | ');
    assert.match(problems, expected, `attendu ${expected} dans : ${problems}`);
  }
});

test('mémoire : un angle différent par réseau, rotation à chaque article', () => {
  const memory = { angleIndex: 0, recent: {} };
  const first = nextAngles(memory, ed.angles, ed.networks);
  const second = nextAngles(memory, ed.angles, ed.networks);
  assert.equal(new Set(Object.values(first)).size, ed.networks.length);
  assert.notDeepEqual(first, second);
  remember(memory, good(), ed.networks, 2);
  remember(memory, good(), ed.networks, 2);
  remember(memory, good(), ed.networks, 2);
  assert.equal(memory.recent.instagram.length, 2);
});

test('légende Instagram : lignes vides préservées, 3 hashtags en fin', async () => {
  const { buildCaption } = await import('../src/channels/instagram.mjs');
  const d = { ...good(), source: 'ia' };
  d.instagram.texte = 'Accroche\n\nSuite';
  const lines = buildCaption(d, 'desc').split('\n');
  assert.deepEqual(lines, ['Accroche', '⠀', 'Suite', '⠀', '➡️ Article complet sur le site Passion Aquitaine', '⠀', '#Bordeaux #Matrimoine #Histoire']);
  d.instagram.texte = 'Accroche\nSuite';
  assert.deepEqual(buildCaption(d, 'desc').split('\n').slice(0, 3), ['Accroche', '⠀', 'Suite']);
});

test('composition : hashtag Bluesky dans le texte, lien X à la suite, commentaire Facebook', async () => {
  const { composeBluesky, composeX, facebookComment } = await import('../src/brain/compose.mjs');
  const d = good();
  d.bluesky.hashtag = '#Bordeaux';
  assert.equal(composeBluesky(d), 'Plus ancien que « patrimoine », le mot matrimoine resurgit depuis plusieurs années dans la vie culturelle bordelaise 🏛️ Origine et usages. #Bordeaux');
  d.bluesky.texte = 'À Bordeaux, le matrimoine revient.';
  assert.equal(composeBluesky(d), 'À #Bordeaux, le matrimoine revient.');
  d.bluesky.hashtag = '#PaysBasque';
  d.bluesky.texte = 'Au Pays basque, un centre soigne les animaux.';
  assert.equal(composeBluesky(d), 'Au Pays basque, un centre soigne les animaux. #PaysBasque');
  assert.equal(composeX(d, 'https://x.fr/a'), `${d.x.texte}\n➡️ https://x.fr/a`);
  d.bluesky.hashtag = '#Bordeaux';
  assert.equal(composeX(d, 'https://x.fr/a'), 'Matrimoine : le mot oublié que #Bordeaux remet à l’honneur 🎭\n➡️ https://x.fr/a');
  const comment = facebookComment({ guid: 'g1', link: 'https://x.fr/a' });
  assert.match(comment, /^\S+ .+ : https:\/\/x\.fr\/a$/u);
  assert.equal(comment, facebookComment({ guid: 'g1', link: 'https://x.fr/a' }));
});

test('contrôles : emojis obligatoires, sobres si sensible, non répétés', () => {
  const d = good();
  d.bluesky.hashtag = '#Bordeaux';
  const base = { ...ctx, sensitiveEmojis: ['📍', '🗞️', '📰', 'ℹ️'] };
  d.x.texte = 'Matrimoine : le mot oublié que Bordeaux remet à l’honneur';
  assert.match(checkDossier(d, base).join(' | '), /x : au moins 1 emoji/);
  d.x.texte = 'Matrimoine : le mot oublié que Bordeaux remet à l’honneur 🎭';
  assert.match(checkDossier(d, { ...base, recentEmojis: { x: [['🎭']] } }).join(' | '), /x : emoji\(s\) 🎭 déjà utilisés/);
  d.sensible = true;
  assert.match(checkDossier(d, base).join(' | '), /sujet sensible, emoji sobre/);
});

test('contrôles : placement de l’emoji imposé, rotation par réseau', async () => {
  const { nextAngles, nextEmojiPositions } = await import('../src/brain/memory.mjs');
  const d = good();
  d.bluesky.hashtag = '#Bordeaux';
  assert.match(checkDossier(d, { ...ctx, emojiPlacement: { instagram: 'en tête du texte' } }).join(' | '), /instagram : emoji attendu en tête/);
  d.instagram.texte = `👀 ${d.instagram.texte.replace(' 👀', '')}`;
  assert.deepEqual(checkDossier(d, { ...ctx, emojiPlacement: { instagram: 'en tête du texte' } }), []);
  assert.match(checkDossier(d, { ...ctx, emojiPlacement: { instagram: 'en fin de texte' } }).join(' | '), /pas en tête/);
  const memory = { angleIndex: 0 };
  nextAngles(memory, ed.angles, ed.networks);
  const first = nextEmojiPositions(memory, ed.emojiPositions, ed.networks);
  nextAngles(memory, ed.angles, ed.networks);
  const second = nextEmojiPositions(memory, ed.emojiPositions, ed.networks);
  assert.notEqual(first.instagram, second.instagram);
  // les placements restent variés d'un réseau à l'autre ; une répétition est possible depuis que
  // Facebook est tenu à l'écart de la position « en tête » (ses 125 premiers caractères sont comptés)
  assert.ok(new Set(Object.values(first)).size >= 3);
  for (const memory of [{ angleIndex: 0 }, { angleIndex: 1 }, { angleIndex: 2 }, { angleIndex: 3 }]) {
    assert.notEqual(nextEmojiPositions(memory, ed.emojiPositions, ed.networks).facebook, 'en tête du texte', 'jamais d’emoji en ouverture sur Facebook');
  }
});

test('contrôles : questions limitées, appâts et point avant emoji refusés', () => {
  const d = good();
  d.bluesky.hashtag = '#Bordeaux';
  assert.match(checkDossier(d, { ...ctx, questions: { facebook: false } }).join(' | '), /facebook : pas de question/);
  assert.deepEqual(checkDossier(d, { ...ctx, questions: { facebook: true } }), []);
  d.x.texte = 'Le matrimoine revient à Bordeaux, partagez !';
  assert.match(checkDossier(d, { ...ctx, baitPatterns: ['partagez'] }).join(' | '), /appel à l'engagement/);
  d.x.texte = 'Le matrimoine revient à Bordeaux. 🎭';
  assert.match(checkDossier(d, ctx).join(' | '), /point juste avant un emoji/);
});

test('similarité : tournures reprises, pas vocabulaire partagé', () => {
  assert.equal(similarity('Le mot matrimoine revient à Bordeaux', 'Le mot matrimoine revient à Bordeaux'), 1);
  assert.ok(similarity('Le matrimoine revient à Bordeaux cet automne', 'Bordeaux : un festival remet le matrimoine au centre') < 0.5);
});

test('contrôles : début de ligne, hashtag et rubrique ne sont pas des noms inventés', () => {
  const d = good();
  d.bluesky.hashtag = '#Bordeaux';
  d.visuel.texte_alternatif = 'Visuel aux couleurs de Bordeaux : le matrimoine';
  d.instagram.texte = 'Comprendre le matrimoine en une minute 🎭\nVous connaissiez ce mot bordelais ?';
  assert.deepEqual(checkDossier(d, ctx), []);
});

test('surlignage : un chiffre avec son unité est valide, même si l’unité est un petit mot', async () => {
  const { checkDossier } = await import('../src/brain/guards.mjs');
  const { readFileSync } = await import('node:fs');
  const { fromRoot } = await import('../src/core/config.mjs');
  const ed = JSON.parse(readFileSync(fromRoot('config/editorial.json'), 'utf8'));
  // 23/09/2026 : « 500 ans » était refusé parce que « ans » figure dans les petits mots, alors que
  // la charte demande justement un chiffre avec son unité. L'article repartait pour un tour — un
  // appel facturé de plus, pour un surlignage qui était le bon.
  const base = {
    nature: 'evergreen', sensible: false, rubrique: 'Vienne',
    visuel: { titre: 'Huit monuments cachent 500 ans de peintures murales', surlignage: '500 ans', description: 'Des fresques du Moyen Âge à nos jours, huit monuments de la Vienne conservent des peintures murales.', texte_alternatif: 'Des peintures murales couvrent les murs de huit monuments de la Vienne.' },
    instagram: { texte: 'Huit monuments de la Vienne cachent des fresques 🎨\nCertaines remontent à plusieurs siècles.', hashtags: ['#Vienne', '#Fresques', '#Patrimoine'] },
    facebook: { texte: 'Huit monuments de la Vienne conservent des peintures murales que presque personne ne regarde 🎨' },
    bluesky: { texte: 'En Vienne, huit monuments conservent des peintures murales qui couvrent cinq siècles de savoir-faire, des fresques religieuses aux décors plus tardifs 🎨', hashtag: '#Vienne' },
    threads: { texte: 'On passe devant sans lever les yeux : huit monuments de la Vienne gardent des peintures murales sur cinq siècles 🖌️', sujet: 'Vienne' },
    x: { texte: 'Huit monuments de la Vienne conservent 500 ans de peintures murales 🖌️' },
  };
  const source = 'Huit monuments cachent 500 ans de peintures murales\nDes fresques du Moyen Âge à nos jours, huit monuments de la Vienne conservent des peintures murales.\nVienne';
  const ctx = { ...ed, source, knownNames: [...ed.knownNames, 'Moyen', 'Âge'] };
  assert.ok(!checkDossier(base, ctx).some((p) => p.includes('petit mot')), '« 500 ans » passe');
  // le petit mot en tête reste refusé, et un petit mot final sans chiffre devant aussi
  const enTete = { ...base, visuel: { ...base.visuel, titre: 'Ces ans de peintures murales oubliées', surlignage: 'ans de peintures' } };
  assert.ok(checkDossier(enTete, ctx).some((p) => p.includes('petit mot')), 'commencer par un petit mot reste refusé');
});
