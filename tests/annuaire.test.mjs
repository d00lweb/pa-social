import { test } from 'node:test';
import assert from 'node:assert/strict';
import { correspond, suspect, choisir, substituer, motsCles } from '../src/brain/annuaire.mjs';
import { identifiantValide } from '../src/brain/lieux.mjs';
import { variantes } from '../src/sources/wikidata.mjs';

test('fiche : le préfixe administratif est retiré, l’article conservé', () => {
  // « Ville de Bordeaux » désigne un cargo sur Wikidata, « Bordeaux » la ville et ses comptes
  assert.deepEqual(variantes('Ville de Bordeaux'), ['Ville de Bordeaux', 'Bordeaux']);
  assert.deepEqual(variantes('Ville de La Rochelle'), ['Ville de La Rochelle', 'La Rochelle', 'Rochelle']);
  assert.deepEqual(variantes('Musée d’Aquitaine'), ['Musée d’Aquitaine']);
});

test('correspondance : tous les mots du nom, accents et casse ignorés', () => {
  const musee = { handle: 'musba-bordeaux.bsky.social', nom: 'Musée des Beaux-Arts de Bordeaux' };
  assert.ok(correspond('Musée des Beaux-Arts de Bordeaux', musee));
  assert.ok(correspond('musee des beaux arts de BORDEAUX', musee));
  // le piège réel : la recherche renvoie toujours quelque chose, ici sans rapport
  assert.ok(!correspond('Village Landais Alzheimer', { handle: 'royalpratt.bsky.social', nom: 'Gregory Pratt' }));
  assert.ok(!correspond('France Alzheimer', { handle: 'afp.com', nom: 'Agence France-Presse' }));
  assert.ok(!correspond('Département des Landes', { handle: 'rlp.de', nom: 'Landesregierung Rheinland-Pfalz' }));
  assert.deepEqual(motsCles('Département des Landes'), ['departement', 'landes']);
  // rencontré en conditions réelles : « ami » se cache dans « gaming », d'où une équipe d'e-sport retenue
  assert.ok(!correspond('L’Ami du Pain', { handle: 'pain.gg', nom: 'paiN Gaming' }));
  assert.ok(correspond('L’Ami du Pain', { handle: 'lamidupain17', nom: 'L’ami du pain' }));
  // un nom d'un seul mot est un filtre faible : le candidat ne doit pas parler d'autre chose
  assert.ok(!correspond('Bordeaux', { handle: 'univbordeaux.bsky.social', nom: 'Université de Bordeaux' }));
  assert.ok(!correspond('Charente-Maritime', { handle: 'x.bsky.social', nom: 'La Charente Maritime Info' }));
  assert.ok(correspond('Bordeaux', { handle: 'villedebordeaux.bsky.social', nom: 'Ville de Bordeaux' }), 'un mot civique reste admis');
  assert.ok(correspond('Landes', { handle: 'departementlandes.bsky.social', nom: 'Département des Landes' }));
});

test('jugement : compte de fans, compte d’info et squatteur écartés', () => {
  assert.ok(suspect({ nom: 'L’Antre de Fort Boyard', description: '', abonnes: 900 }));
  assert.ok(suspect({ nom: 'La Charente Maritime Info', description: 'Tout sur le département', abonnes: 93 }));
  assert.ok(suspect({ nom: 'Dans le Noir', description: '', abonnes: 7 }), 'profil vide et sans abonnés');
  assert.ok(!suspect({ nom: 'Département des Landes', description: 'Compte officiel du Conseil départemental', abonnes: 1200 }));
});

test('sélection : deux comptes au maximum, le sujet avant le thème', () => {
  const retenus = choisir([
    { entite: 'UNAF', handle: 'unafapiculture', role: 'theme' },
    { entite: 'Département des Landes', handle: 'departementdeslandes', role: 'acteur' },
    { entite: 'Musée', handle: 'musee', role: 'sujet' },
    { entite: 'Ville', handle: 'ville', role: 'tutelle' },
  ]);
  assert.deepEqual(retenus.map((c) => c.role), ['sujet', 'acteur']);
});

test('mention dans un texte : substitution du nom, jamais d’ajout', () => {
  assert.equal(
    substituer('Au musée d’Aquitaine, le monument dédié à Montaigne est resté vide.', 'musée d’Aquitaine', 'musee_aquitaine'),
    'Au @musee_aquitaine, le monument dédié à Montaigne est resté vide.',
  );
  // le nom n'est pas dans le texte : aucune mention, plutôt qu'un pseudo collé à la fin
  assert.equal(substituer('À La Rochelle, une devanture d’1,15 mètre.', 'Charente-Maritime', 'ma_charente_maritime'), null);
  // rencontré en conditions réelles : le hashtag de lieu ne doit pas être dévoré
  assert.equal(substituer('Le monument dédié à Montaigne 🏛️ #Bordeaux', 'Bordeaux', 'villedebordeaux.bsky.social'), null);
  assert.equal(
    substituer('À Bordeaux, le monument 🏛️ #Bordeaux', 'Bordeaux', 'villedebordeaux.bsky.social'),
    'À @villedebordeaux.bsky.social, le monument 🏛️ #Bordeaux',
  );
  // jamais au milieu d'un mot plus long
  assert.equal(substituer('Les Bordelais adorent 🍷', 'Bordeaux', 'villedebordeaux'), null);
});

test('lieu : seuls les identifiants longs sont acceptés par Meta', () => {
  assert.ok(identifiantValide('228169691058500'), 'Haute-Vienne, vérifié en conditions réelles');
  assert.ok(identifiantValide('115838035093755'), 'Bordeaux');
  assert.ok(!identifiantValide('213097372'), 'ancien identifiant Instagram, refusé');
  assert.ok(!identifiantValide(''));
  assert.ok(!identifiantValide(null));
});
