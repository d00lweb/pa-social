import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classerLieu, lieuNomme } from '../src/brain/lieux.mjs';
import { composeBluesky, composeXText, hashtagCommune } from '../src/brain/compose.mjs';
import { refusDeLieu } from '../src/measure/recolte.mjs';

// Cas tirés de l'inventaire réel de la page Facebook (550 publications, 41 lieux, 18/09/2026).
// Chacun verrouille un piège : un établissement rangé sous sa commune, une page de département
// mal localisée, une orthographe de hashtag inventée.

const lieu = (id, name, city, country = 'France') => ({ id, name, location: city ? { city, country } : {} });

test('une page de commune est apprise comme commune, sous le nom de la ville', () => {
  assert.deepEqual(
    classerLieu(lieu('115412131809526', 'Gamarde-Les-Bains, Aquitaine, France', 'Gamarde-les-Bains')),
    { section: 'communes', nom: 'Gamarde-les-Bains', id: '115412131809526' },
  );
  assert.equal(classerLieu(lieu('107938435901383', 'Sarlat-la-Canéda', 'Sarlat-la-Canéda')).section, 'communes');
});

test('un établissement garde son propre nom, jamais celui de sa commune', () => {
  assert.deepEqual(classerLieu(lieu('298653744417', 'Martell', 'Cognac')), { section: 'lieux', nom: 'Martell', id: '298653744417' });
  assert.equal(classerLieu(lieu('1006881796032414', 'Restaurant Le Bordeaux', 'Bordeaux')).section, 'lieux', 'pas la commune Bordeaux');
  assert.equal(classerLieu(lieu('138503822862006', 'Dune du Pilat', 'La Teste-de-Buch')).nom, 'Dune du Pilat');
});

test('un nom de département n’est jamais appris : ses pages Facebook sont mal localisées', () => {
  assert.equal(classerLieu(lieu('108139685880282', 'Dordogne', 'Die')), null, 'localisée à Die, dans la Drôme');
  assert.equal(classerLieu(lieu('106180462747078', 'Lot-et-Garonne', 'Saint-Nicolas-de-la-Grave')), null);
  assert.equal(classerLieu(lieu('113287278697423', 'Corrèze, Limousin, France', 'Corrèze')), null, 'village ou département : ambigu');
});

test('un lieu à l’étranger ou sans ville reste un lieu précis', () => {
  assert.equal(classerLieu(lieu('198409207347457', 'San Sebastián', 'Donostia-San Sebastián', 'Spain')).section, 'lieux');
  assert.equal(classerLieu(lieu('106849122682128', 'Ville de Dax', null)).section, 'lieux');
});

test('une entrée incomplète est ignorée', () => {
  assert.equal(classerLieu({}), null);
  assert.equal(classerLieu({ id: '123', name: '' }), null);
  assert.equal(classerLieu(null), null);
});

test('le nom de lieu ne dépend d’aucun identifiant et ignore une rubrique thématique', () => {
  assert.equal(lieuNomme({ precis: 'Dune du Pilat', ville: 'La Teste-de-Buch' }), 'Dune du Pilat');
  assert.equal(lieuNomme({ ville: 'Espelette', departement: 'Pyrénées-Atlantiques', zone: 'Pays basque' }), 'Espelette');
  assert.equal(lieuNomme({ departement: 'Dordogne', zone: 'Périgord' }), 'Périgord');
  assert.equal(lieuNomme({ zone: 'Patrimoine' }), null, 'une rubrique thématique ne se tague pas');
  assert.equal(lieuNomme({ departement: 'Gironde', zone: 'Gastronomie' }), 'Gironde');
});

test('hashtag de commune : sans accents, en CamelCase', () => {
  assert.equal(hashtagCommune('Espelette'), '#Espelette');
  assert.equal(hashtagCommune('Saint-Émilion'), '#SaintEmilion');
  assert.equal(hashtagCommune(''), null);
});

const dossier = (texte, extra = {}) => ({ bluesky: { texte, hashtag: '#PaysBasque' }, x: { texte }, ...extra });

test('la commune nommée devient le hashtag, à sa place dans le texte', () => {
  assert.equal(composeBluesky(dossier('À Espelette, le piment sèche au soleil.', { commune: 'Espelette' })), 'À #Espelette, le piment sèche au soleil.');
  assert.equal(composeXText(dossier('À Espelette, le piment sèche.', { commune: 'Espelette' })), 'À #Espelette, le piment sèche.');
});

test('jamais de hashtag de commune inventé ou illisible : la rubrique reprend la main', () => {
  assert.equal(composeBluesky(dossier('Le piment sèche au soleil.', { commune: 'Espelette' })), 'Le piment sèche au soleil. #PaysBasque', 'absente du texte : pas ajoutée');
  assert.equal(composeBluesky(dossier('Le piment d’Espelette sèche.', { commune: 'Espelette' })), 'Le piment d’Espelette sèche. #PaysBasque', 'pas de « d’#Espelette »');
  assert.equal(composeBluesky(dossier('À Périgueux, la cathédrale.', { commune: 'Périgueux' })), 'À Périgueux, la cathédrale. #PaysBasque', 'pas de #Perigueux inventé');
});

test('sans commune, le comportement historique est inchangé', () => {
  assert.equal(composeBluesky(dossier('Au Pays basque, le piment sèche.')), 'Au Pays basque, le piment sèche. #PaysBasque');
});

// Martell, Château de La Dauphine et Bouillon & Bodega de Mérignac : tagués sur de vrais posts
// Facebook, refusés par Instagram sous un message générique. Traités comme une panne passagère,
// ils empêchaient la récolte de se terminer et la faisaient tout relire chaque heure.
test('un refus de lieu est reconnu quelle que soit sa formulation', () => {
  assert.ok(refusDeLieu({ code: 100, error_subcode: 2207019, message: 'Invalid parameter' }), 'sous-code, message générique');
  assert.ok(refusDeLieu({ code: 100, message: '(#100) Param location_id is not a valid location page ID' }));
  assert.ok(!refusDeLieu({ code: 4, message: 'Application request limit reached' }), 'un quota se retente');
  assert.ok(!refusDeLieu({ code: 9004, message: 'Only photo or video can be accepted as media type.' }), 'une image refusée se retente');
  assert.ok(!refusDeLieu(undefined));
});
