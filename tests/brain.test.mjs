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
  instagram: { texte: 'Un mot plus vieux que patrimoine refait surface.\nÀ Bordeaux, festivals et histoire lui redonnent vie.', hashtags: ['#Bordeaux', '#Matrimoine', '#Histoire'] },
  facebook: { texte: 'Vous connaissiez le matrimoine ? Ce terme ancien revient dans les festivals bordelais.' },
  bluesky: { texte: 'Plus ancien que « patrimoine », le mot matrimoine resurgit depuis plusieurs années dans la vie culturelle bordelaise. Origine et usages.' },
  threads: { texte: 'On parle beaucoup de patrimoine. Et si son jumeau oublié revenait ? À Bordeaux, les festivals remettent le matrimoine au centre.', sujet: 'Bordeaux' },
  x: { texte: 'Matrimoine : le mot oublié que Bordeaux remet à l’honneur.' },
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
    [(d) => { d.facebook.texte = 'Le matrimoine revient 🎭✨'; }, /emoji/],
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
});

test('similarité : tournures reprises, pas vocabulaire partagé', () => {
  assert.equal(similarity('Le mot matrimoine revient à Bordeaux', 'Le mot matrimoine revient à Bordeaux'), 1);
  assert.ok(similarity('Le matrimoine revient à Bordeaux cet automne', 'Bordeaux : un festival remet le matrimoine au centre') < 0.5);
});

test('contrôles : début de ligne, hashtag et rubrique ne sont pas des noms inventés', () => {
  const d = good();
  d.bluesky.hashtag = '#Bordeaux';
  d.visuel.texte_alternatif = 'Visuel aux couleurs de Bordeaux : le matrimoine';
  d.instagram.texte = 'Comprendre le matrimoine en une minute.\nVous connaissiez ce mot bordelais ?';
  assert.deepEqual(checkDossier(d, ctx), []);
});
