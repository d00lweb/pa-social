import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickRubrique, stripGeoLead, pickHighlight, splitAround, frenchTypography } from '../src/brain/editorial.mjs';

const hl = (title, avoid = []) => pickHighlight(frenchTypography(title), { avoid }).highlight;

test('surlignage : chiffre avec son unité ou son nom en priorité', () => {
  assert.equal(hl('Les abeilles tuent le frelon en le chauffant vivant à 42°C'), '42 °C');
  assert.equal(hl('Mont-de-Marsan paiera 400 000 € de pénalités pour avoir freiné son chantier de musée'), '400 000 €');
  assert.equal(hl('Hegalaldia : le centre qui soigne 2 500 animaux sauvages par an'), '2 500 animaux');
  assert.equal(hl('Vos courses peuvent coûter 21 euros de plus'), '21 euros');
});

test('surlignage : nom propre, hors rubrique', () => {
  assert.equal(hl('La plus grande cascade de France se cache dans les Pyrénées', ['France']), 'les Pyrénées');
  assert.equal(hl('Les brebis de Bordeaux vont défiler à Cenon', ['Bordeaux']), 'Cenon');
  assert.equal(hl('Cette ville d’Espagne au bord de la mer ressemble à Bordeaux', ['Bordeaux']), 'Espagne');
});

test('surlignage : fin de titre sans petit mot en bordure', () => {
  assert.equal(hl('Pourquoi Bordeaux parle désormais de « matrimoine »', ['Bordeaux']), 'matrimoine');
  assert.equal(hl('Pourquoi ces grottes troglodytes portent le nom d’un navire disparu ?'), 'navire disparu');
  assert.equal(hl('Chasse : la Gironde rouvre après un bilan sécurité inédit', ['Gironde']), 'bilan sécurité inédit');
  assert.equal(hl('Cette ville est la nouvelle capitale de l’électro'), 'l’électro');
});

test('découpage autour du surlignage', () => {
  const title = frenchTypography('Pourquoi Bordeaux parle désormais de « matrimoine »');
  const parts = splitAround(title, 'matrimoine');
  assert.equal(parts.before + parts.highlight + parts.after, title);
  assert.equal(parts.highlight, 'matrimoine');
});

test('guillemets français : espaces fines insécables à l’intérieur', () => {
  assert.equal(frenchTypography('de « matrimoine »'), 'de « matrimoine »');
  assert.equal(frenchTypography('de «matrimoine»'), 'de « matrimoine »');
});

test('amorce géographique retirée quand elle répète la rubrique', () => {
  assert.equal(stripGeoLead('En Haute-Vienne, les abeilles tuent le frelon', 'Haute-Vienne'), 'Les abeilles tuent le frelon');
  assert.equal(stripGeoLead('À Bordeaux, vos courses coûtent plus cher', 'Bordeaux'), 'Vos courses coûtent plus cher');
  assert.equal(stripGeoLead('Dans les Landes, un village résiste', 'Landes'), 'Un village résiste');
  assert.equal(stripGeoLead('À Pau, un record', 'Bordeaux'), 'À Pau, un record');
});

test('rubrique : jamais générique ni étiquette interne', () => {
  assert.equal(pickRubrique(['Actus', 'Agriculture', 'Haute-Vienne']), 'Haute-Vienne');
  assert.equal(pickRubrique(['Actus', 'Culture & traditions']), 'Culture & traditions');
  assert.equal(pickRubrique(['Actus']), '');
  assert.equal(pickRubrique(['Actus', 'Charente MA LOI']), '');
});

test('typographie française', () => {
  assert.equal(frenchTypography('3 500 €'), '3 500 €');
  assert.equal(frenchTypography('Pourquoi?'), 'Pourquoi ?');
  assert.equal(frenchTypography('Rendez-vous à 14:30'), 'Rendez-vous à 14:30');
  assert.equal(frenchTypography('En 2024 300 visiteurs'), 'En 2024 300 visiteurs');
});
