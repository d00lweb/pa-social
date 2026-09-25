import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retenir, parleDu, semblFrancais, formesInstagram, surInstagram, surBluesky, SEUILS } from '../src/brain/decouverte.mjs';

// 25/09/2026 : les tables de comptes écrites à la main ne couvraient que sept domaines. Sur les six
// premières publications du média — patrimoine, féminisme, gastronomie, santé, apiculture — aucune
// ne déclenchait quoi que ce soit. D'où un moteur de découverte. Tous les cas ci-dessous sont des
// comptes réellement rencontrés en interrogeant Instagram et Bluesky.

const compte = (nom, description, abonnes, handle = 'x') => ({ handle, nom, description, abonnes });

test('la porte du domaine sépare une institution d’un particulier', () => {
  // ce qui doit passer : le domaine est dans le NOM du compte
  assert.ok(parleDu('féminisme', compte('Osez le Féminisme', 'Association féministe militante', 1805)));
  assert.ok(parleDu('patrimoine', compte('Fondation du patrimoine', 'Première organisation privée en France', 334)));
  assert.ok(parleDu('alzheimer', compte('France Alzheimer', 'Association de soutien aux familles', 10700)));
  assert.ok(parleDu('apiculture', compte('Apiculture France', 'L’apiculture française', 153)), 'la racine suffit');

  // ce qui doit tomber : des particuliers dont la biographie cite le domaine. Sans cette règle,
  // la recherche « gastronomie » proposait trois personnes sur quatre résultats.
  assert.ok(!parleDu('féminisme', compte('Elisa Rojas', 'avocate, militante féministe', 10795)));
  assert.ok(!parleDu('féminisme', compte('La meuf là', 'féminisme au quotidien', 10892)));
  assert.ok(!parleDu('gastronomie', compte('Tonton Alberto', 'j’aime la gastronomie', 1259)));
  assert.ok(!parleDu('vin', compte('X', 'on parle de vin', 5000)), 'un domaine de moins de 4 lettres n’est pas cherchable');
});

test('la langue se juge sur la biographie, jamais sur l’enseigne', () => {
  // « Gastronomie France », 17 698 abonnés : une agence de recrutement espagnole
  assert.ok(!semblFrancais('✈️ 10 AÑOS DE EXPERIENCIA 🧑‍🍳 +900 candidatos 🏨 +210 establecimientos'));
  // la boutique indonésienne trouvée sous « patrimoine »
  assert.ok(!semblFrancais('We are the same roof with @2010madewithlove Order via WA only: +628132215977'));
  // les associations anglophones d’Alzheimer
  assert.ok(!semblFrancais('We want a world where dementia no longer devastates lives.'));
  // francophone ne veut pas dire français
  assert.ok(!semblFrancais('Le compte officiel de la santé au Québec'));
  assert.ok(!semblFrancais('Notre association suisse de patrimoine'));
  // ce qui doit passer
  assert.ok(semblFrancais('Association de soutien aux familles touchées par Alzheimer'));
  assert.ok(semblFrancais('Première organisation privée en France dédiée à la préservation du patrimoine'));
  assert.ok(!semblFrancais(''), 'une biographie vide ne prouve rien');
});

test('les quatre portes, et le motif de chaque refus', () => {
  const bon = compte('France Alzheimer', 'Association de soutien aux familles touchées', 10700);
  assert.deepEqual(retenir(bon, { domaine: 'alzheimer', reseau: 'instagram' }), { garde: true, motif: null });

  const petit = compte('Apiculture France', 'L’apiculture française mise à l’honneur', 153);
  assert.match(retenir(petit, { domaine: 'apiculture', reseau: 'instagram' }).motif, /153 abonnés/);
  assert.equal(SEUILS.instagram, 3000);
  assert.ok(SEUILS.bluesky < SEUILS.instagram, 'Bluesky est un réseau jeune : le seuil y est plus bas');

  const perso = compte('Elisa Rojas', 'avocate et militante féministe', 10795);
  assert.match(retenir(perso, { domaine: 'féminisme', reseau: 'instagram' }).motif, /n’est pas une institution/);

  const espagnol = compte('Gastronomie France', '10 AÑOS DE EXPERIENCIA, +900 candidatos', 17698);
  assert.match(retenir(espagnol, { domaine: 'gastronomie', reseau: 'instagram' }).motif, /biographie non française/);

  assert.match(retenir(compte('X', 'y', null), { domaine: 'z', reseau: 'instagram' }).motif, /audience inconnue/);
});

test('les pseudos candidats suivent les usages français, et rien de plus', () => {
  const f = formesInstagram('apiculture');
  assert.ok(f.includes('apiculture') && f.includes('franceapiculture') && f.includes('apiculturefrance'));
  assert.ok(f.every((h) => /^[a-z0-9._]+$/.test(h)), 'pseudos valides');
  assert.deepEqual(formesInstagram('vin'), [], 'un mot trop court ne se cherche pas');
});

test('découverte Instagram : ce qui passe, ce qui est écarté et pourquoi', async () => {
  const fiches = {
    francealzheimer: { username: 'francealzheimer', name: 'France Alzheimer', biography: 'Association de soutien aux familles touchées par Alzheimer', followers_count: 10700 },
    alzheimerfrance: { username: 'alzheimerfrance', name: 'Alzheimer', biography: 'The leading voluntary health organization', followers_count: 40000 },
    alzheimer: { username: 'alzheimer', name: 'alzheimer', biography: '', followers_count: 12 },
  };
  const dit = [];
  const trouves = await surInstagram('alzheimer', { decrire: async (h) => fiches[h] ?? null, log: (m) => dit.push(m.trim()) });
  assert.deepEqual(trouves.map((c) => c.handle), ['francealzheimer']);
  assert.equal(dit.length, 2, 'les deux refus sont expliqués');
});

test('découverte Bluesky : la recherche propose, le filtre dispose', async () => {
  const profils = {
    'osezlefeminisme.bsky.social': { nom: 'Osez le Féminisme', description: 'Association féministe militante, abolitionniste, intersectionnelle', abonnes: 1805 },
    'elisarojas.bsky.social': { nom: 'Elisa Rojas', description: 'avocate, militante féministe', abonnes: 10795 },
    'inkluderendefeminisme.no': { nom: 'Inkluderende feminisme', description: 'Vi bygger en inkluderende feministisk bevegelse', abonnes: 1387 },
  };
  const trouves = await surBluesky('féminisme', {
    chercher: async () => Object.keys(profils).map((handle) => ({ handle })),
    lireProfil: async (h) => profils[h],
  });
  assert.deepEqual(trouves.map((c) => c.handle), ['osezlefeminisme.bsky.social'], 'l’association passe, la militante et le collectif norvégien non');
});

test('l’échelle géographique : la commune d’abord, et son nom peut être court', async () => {
  const { formesCommune, parleDu, retenir } = await import('../src/brain/decouverte.mjs');
  // Les formes usuelles d'une commune française sont stables : c'est ce qui rend la découverte
  // fiable ici, là où elle échoue sur un domaine abstrait.
  const f = formesCommune('Bayonne');
  assert.ok(f.includes('bayonnemaville') && f.includes('visitbayonne'), f.join(' '));
  assert.ok(formesCommune('Saint-Jean-de-Luz').includes('visitsaintjeandeluz'), 'les traits d’union tombent');
  assert.deepEqual(formesCommune('X'), []);

  // « Dax » fait trois lettres : le filtre l'écartait, privant l'article du compte de sa ville
  assert.ok(parleDu('Dax', { nom: 'Grand Dax Tourisme' }));
  assert.ok(retenir({ handle: 'daxtourisme', nom: 'Grand Dax Tourisme', description: 'Compte officiel de l’Office de Tourisme du Grand Dax', abonnes: 5295 }, { domaine: 'Dax', reseau: 'instagram' }).garde);

  // mais la racine doit commencer un mot : sans cette frontière, « trail » se reconnaissait dans
  // « PaperTrail Media », une rédaction d'investigation allemande
  assert.equal(parleDu('trail', { nom: 'PaperTrail Media' }), false);
  assert.ok(parleDu('trail', { nom: 'Trail Passion' }));
  assert.ok(parleDu('trail', { nom: 'Lestraileurs | Conseils & Actus Trail' }));

  // le domaine national du pseudo tranche aussi
  const allemand = { handle: 'papertrailmedia.de', nom: 'Trail Media', description: 'Une rédaction de référence', abonnes: 9000 };
  assert.match(retenir(allemand, { domaine: 'trail', reseau: 'bluesky' }).motif, /domaine national étranger/);

  // et le piège de La Rochelle reste fermé : un domaine événementiel brésilien à 92 295 abonnés
  const bresil = { handle: 'villelarochelle', nom: 'VILLE LA ROCHELLE | Locação para Eventos', description: 'Uma propriedade familiar no estilo europeu para eventos no interior de São Paulo', abonnes: 92295 };
  assert.match(retenir(bresil, { domaine: 'La Rochelle', reseau: 'instagram' }).motif, /biographie non française/);
});
