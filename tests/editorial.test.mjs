import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickRubrique, stripGeoLead, splitHighlight, frenchTypography } from '../src/brain/editorial.mjs';

const highlight = (title) => splitHighlight(frenchTypography(title)).highlight;

test('groupe surligné : cas de la spécification', () => {
  assert.equal(highlight('La plus grande cascade de France se cache dans les Pyrénées'), 'les Pyrénées');
  assert.equal(highlight('Cette ville est la nouvelle capitale de l’électro'), 'l’électro');
  assert.equal(highlight('Le corps de Montaigne a disparu pendant plus d’un siècle'), 'd’un siècle');
  assert.equal(highlight('Les abeilles tuent le frelon en le chauffant vivant à 42°C'), '42 °C');
});

test('groupe surligné : ponctuation finale laissée hors du surlignage', () => {
  const parts = splitHighlight(frenchTypography('Pourquoi Bordeaux parle désormais de « matrimoine »'));
  assert.equal(parts.highlight, 'matrimoine');
  assert.equal(parts.before + parts.highlight + parts.after, frenchTypography('Pourquoi Bordeaux parle désormais de « matrimoine »'));
});

test('amorce géographique retirée quand elle répète la rubrique', () => {
  assert.equal(stripGeoLead('En Haute-Vienne, les abeilles tuent le frelon', 'Haute-Vienne'), 'Les abeilles tuent le frelon');
  assert.equal(stripGeoLead('À Bordeaux, vos courses coûtent plus cher', 'Bordeaux'), 'Vos courses coûtent plus cher');
  assert.equal(stripGeoLead('Dans les Landes, un village résiste', 'Landes'), 'Un village résiste');
  assert.equal(stripGeoLead('À Pau, un record', 'Bordeaux'), 'À Pau, un record');
});

test('rubrique : géographie, puis première catégorie non générique', () => {
  assert.equal(pickRubrique(['Actus', 'Agriculture', 'Haute-Vienne']), 'Haute-Vienne');
  assert.equal(pickRubrique(['Actus', 'Culture & traditions']), 'Culture & traditions');
  assert.equal(pickRubrique(['Actus']), 'Actus');
  assert.equal(pickRubrique([]), '');
});

test('typographie française', () => {
  assert.equal(frenchTypography('3 500 €'), '3 500 €');
  assert.equal(frenchTypography('Pourquoi?'), 'Pourquoi ?');
  assert.equal(frenchTypography('Rendez-vous à 14:30'), 'Rendez-vous à 14:30');
  assert.equal(frenchTypography('En 2024 300 visiteurs'), 'En 2024 300 visiteurs');
});
