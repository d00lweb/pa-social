import { test } from 'node:test';
import assert from 'node:assert/strict';
import { departementDeZone, etapes, identifiantValide } from '../src/brain/lieux.mjs';

// Meta ne connaît ni « Périgord » ni « Pays basque » comme lieux, et n'accepte que les
// identifiants longs. Règle de conduite : on n'élargit qu'en remontant vers le lieu qui
// contient, jamais vers un voisin. Bayonne n'est pas le Pays basque, Dax n'est pas les Landes.

const noms = (source) => etapes(source).map(([, nom]) => nom);
const niveaux = (source) => etapes(source).map(([niveau]) => niveau);

test('une zone identitaire remonte au département qui la contient', () => {
  assert.equal(departementDeZone('Périgord'), 'Dordogne');
  assert.equal(departementDeZone('Pays basque'), 'Pyrénées-Atlantiques');
  assert.equal(departementDeZone('Marais poitevin'), 'Deux-Sèvres');
});

test('les alias du lexique fonctionnent aussi', () => {
  assert.equal(departementDeZone('Sarlat'), 'Dordogne', 'une commune citée par le lexique');
  assert.equal(departementDeZone('Fort Boyard'), 'Charente-Maritime');
});

test('accents et apostrophes n’empêchent pas la correspondance', () => {
  assert.equal(departementDeZone('bassin d’arcachon'), 'Gironde', 'apostrophe typographique');
  assert.equal(departementDeZone("BASSIN D'ARCACHON"), 'Gironde', 'apostrophe droite et casse');
});

test('rien d’inventé quand la zone est inconnue ou vide', () => {
  assert.equal(departementDeZone('Bretagne'), null);
  assert.equal(departementDeZone(''), null);
  assert.equal(departementDeZone(null), null);
});

test('les marches vont du plus précis au plus large', () => {
  assert.deepEqual(
    noms({ precis: 'Musée d’Aquitaine', ville: 'Bordeaux', departement: 'Gironde', zone: 'Bordeaux' }),
    ['Musée d’Aquitaine', 'Bordeaux', 'Gironde', 'Gironde'],
  );
  assert.deepEqual(niveaux({ ville: 'Dax', departement: 'Landes' }), ['ville', 'departement']);
});

test('une ville nommée interdit de retomber sur une autre commune', () => {
  // Pessac n’a pas d’identifiant : on remonte à la Gironde, jamais vers « Bordeaux »
  const source = { ville: 'Pessac', departement: 'Gironde', zone: 'Bordeaux' };
  assert.ok(!niveaux(source).includes('zone'), 'aucune marche « zone » tant qu’une ville est nommée');
  assert.ok(!noms(source).includes('Bordeaux'), 'jamais la commune voisine');
});

test('sans ville nommée, le nom de la zone est tenté tel quel', () => {
  const source = { departement: 'Dordogne', zone: 'Périgord' };
  // « Dordogne » n'est plus tenté comme commune : un département ne se résout jamais en village
  assert.deepEqual(noms(source), ['Dordogne', 'Dordogne', 'Périgord']);
  assert.equal(niveaux(source).at(-1), 'zone');
});

test('les champs vides ne créent pas de marche', () => {
  assert.deepEqual(etapes({}), []);
  assert.deepEqual(noms({ precis: '  ', ville: '', departement: 'Vienne' }), ['Vienne'], 'Vienne, département, jamais la commune de l’Isère');
});

test('seuls les identifiants longs sont acceptés', () => {
  assert.ok(identifiantValide('228169691058500'));
  assert.ok(!identifiantValide('233577251'), 'ancien format Instagram, refusé par Meta');
  assert.ok(!identifiantValide(''));
});

test('un nom de département n’est jamais tenté comme commune', () => {
  // Corrèze est aussi un village : un article sur le département ne doit pas être tagué au village
  const source = { departement: 'Corrèze', zone: 'Brive' };
  assert.ok(!etapes(source).some(([niveau, nom]) => niveau === 'zone' && nom === 'Corrèze'));
  assert.ok(etapes(source).some(([niveau, nom]) => niveau === 'zone' && nom === 'Brive'), 'la zone, elle, reste tentée');
});
