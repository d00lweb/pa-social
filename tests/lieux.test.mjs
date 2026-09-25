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

test('zones d’identité : jamais proposées sans que les données les justifient', async () => {
  const { candidateZones, resolvePlace } = await import('../src/brain/geo.mjs');
  // 25/09/2026 : « En Charente-Maritime, nouveau succès pour l'Ultra Trail de Pons » est parti sur
  // Instagram avec « Saintonge » en rubrique. Le programme proposait au rédacteur toutes les zones
  // du département — Île de Ré, Oléron, La Rochelle, Royan, Saintonge — alors qu'aucune ne contient
  // Pons. Le rédacteur a pris la moins fausse ; il aurait pu répondre « Île de Ré ».
  const pons = {
    title: 'En Charente-Maritime, nouveau succès pour l’Ultra Trail de Pons',
    description: '2 740 inscrits venus de France, du Canada ou de La Réunion : l’Ultra Trail de Pons signe une édition 2026 record.',
    categories: ['Actus', 'Charente-Maritime', 'Sport'],
  };
  assert.deepEqual(candidateZones(pons, resolvePlace(pons)), [], 'aucune zone : les données n’en nomment aucune');

  // les vrais cas continuent de passer, par le nom de la zone ou par une de ses communes
  const cas = [
    [{ title: 'À Saint-Martin-de-Ré, les remparts rouvrent', description: 'Vauban.', categories: ['Charente-Maritime'] }, 'Île de Ré'],
    [{ title: 'Le marché de Saintes fête ses 200 ans', description: 'Sur la Charente.', categories: ['Charente-Maritime'] }, 'Saintonge'],
    [{ title: 'Un château retrouve son toit', description: 'Le Périgord noir en compte des dizaines.', categories: ['Dordogne'] }, 'Périgord'],
  ];
  for (const [article, attendu] of cas) {
    assert.ok(candidateZones(article, resolvePlace(article)).includes(attendu), `${attendu} attendu pour « ${article.title} »`);
  }
  // un mot ne compte que s'il est entier : « Ars-en-Ré » ne doit pas surgir d'un « Pars »
  assert.deepEqual(candidateZones({ title: 'Il repars demain', description: '', categories: ['Charente-Maritime'] }, null), []);
});

test('rubrique : refusée si les données ne la justifient pas', async () => {
  const { checkDossier } = await import('../src/brain/guards.mjs');
  const { readFileSync } = await import('node:fs');
  const { fromRoot } = await import('../src/core/config.mjs');
  const ed = JSON.parse(readFileSync(fromRoot('config/editorial.json'), 'utf8'));
  const source = 'En Charente-Maritime, nouveau succès pour l’Ultra Trail de Pons\n2 740 inscrits : l’Ultra Trail de Pons signe une édition 2026 record.\nCharente-Maritime, Sport';
  const dossier = (rubrique) => ({
    nature: 'actu', sensible: false, rubrique,
    visuel: { titre: 'Nouveau succès pour l’Ultra Trail de Pons', surlignage: '2 740 inscrits', description: 'L’Ultra Trail de Pons signe une édition record avec 2 740 inscrits.', texte_alternatif: 'Des coureurs sur le parcours de l’Ultra Trail de Pons.' },
    instagram: { texte: '2 740 coureurs sur les chemins 🏃\nL’Ultra Trail de Pons signe une édition record.', hashtags: ['#Pons', '#Trail', '#Sport'] },
    facebook: { texte: '2 740 inscrits venus jusqu’du Canada pour courir l’Ultra Trail de Pons 🏃' },
    bluesky: { texte: 'Venus de France, du Canada ou de La Réunion, 2 740 coureurs ont pris le départ de l’Ultra Trail de Pons, qui signe là son édition record 🏃', hashtag: '#CharenteMaritime' },
    threads: { texte: 'Courir 2 740 à travers la campagne : l’Ultra Trail de Pons a fait le plein cette année 🏅', sujet: 'Sport' },
    x: { texte: 'L’Ultra Trail de Pons signe une édition record : 2 740 inscrits 🏅' },
  });
  const ctx = { ...ed, source, knownNames: ed.knownNames, rubriquesAutorisees: ['Sport', 'Charente-Maritime', 'Patrimoine'] };
  const refus = checkDossier(dossier('Saintonge'), ctx).filter((p) => p.includes('rubrique'));
  assert.deepEqual(refus, ['rubrique absente des données : « Saintonge »']);
  for (const bonne of ['Charente-Maritime', 'Sport', 'Pons']) {
    assert.equal(checkDossier(dossier(bonne), ctx).filter((p) => p.includes('rubrique absente')).length, 0, `${bonne} doit passer`);
  }
  // sans liste fournie, le contrôle ne s'applique pas : les anciens appels restent valides
  assert.equal(checkDossier(dossier('Saintonge'), { ...ctx, rubriquesAutorisees: null }).filter((p) => p.includes('rubrique absente')).length, 0);
});

test('rubrique d’un dossier déjà en file : revalidée avant publication', async () => {
  const { rubriqueJustifiee } = await import('../src/brain/dossier.mjs');
  const pons = {
    title: 'En Charente-Maritime, nouveau succès pour l’Ultra Trail de Pons',
    description: '2 740 inscrits : l’Ultra Trail de Pons signe une édition 2026 record.',
    categories: ['Actus', 'Charente-Maritime', 'Sport'],
  };
  const bidache = { title: 'À Bidache, vivez 2000 ans d’histoire en un week-end', description: 'Le château et son histoire.', categories: ['Actus', 'Pyrénées-Atlantiques'] };
  // les deux dossiers écrits avant le durcissement : la file en portait un de chaque
  assert.equal(rubriqueJustifiee(pons, 'Saintonge'), false);
  assert.equal(rubriqueJustifiee(bidache, 'Pays basque'), false);
  // ce que les données justifient vraiment
  assert.equal(rubriqueJustifiee(pons, 'Charente-Maritime'), true);
  assert.equal(rubriqueJustifiee(pons, 'Pons'), true, 'la commune figure dans le titre');
  assert.equal(rubriqueJustifiee(pons, 'Sport'), true, 'rubrique thématique');
  assert.equal(rubriqueJustifiee(bidache, 'Pyrénées-Atlantiques'), true);
  assert.equal(rubriqueJustifiee(pons, ''), false);
});
