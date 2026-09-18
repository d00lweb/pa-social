import { test } from 'node:test';
import assert from 'node:assert/strict';
import { departementDeZone, villeDeZone, identifiantValide } from '../src/brain/lieux.mjs';

// Meta ne connaît ni « Périgord » ni « Pays basque » comme lieux, et n'accepte que les
// identifiants longs. Ces conversions sont le seul moyen de géolocaliser un article de zone.

test('une zone identitaire remonte à son département administratif', () => {
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
  assert.equal(villeDeZone("Bassin d'Arcachon"), 'Arcachon', 'apostrophe droite');
  assert.equal(villeDeZone('PERIGORD'), 'Périgueux');
});

test('rien d’inventé quand la zone est inconnue ou vide', () => {
  assert.equal(departementDeZone('Bretagne'), null);
  assert.equal(departementDeZone(''), null);
  assert.equal(villeDeZone(null), null);
  assert.equal(villeDeZone('Médoc'), null, 'aucune ville ne représente le Médoc : pas de repli');
});

test('seuls les identifiants longs sont acceptés', () => {
  assert.ok(identifiantValide('228169691058500'));
  assert.ok(!identifiantValide('233577251'), 'ancien format Instagram, refusé par Meta');
  assert.ok(!identifiantValide(''));
});
