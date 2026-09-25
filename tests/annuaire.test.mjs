import { test } from 'node:test';
import assert from 'node:assert/strict';
import { correspond, suspect, choisir, substituer, motsCles, nomExploitable } from '../src/brain/annuaire.mjs';
import { variantesHandle } from '../src/brain/comptes.mjs';
import { identifiantValide } from '../src/brain/lieux.mjs';
import { variantes } from '../src/sources/wikidata.mjs';

test('fiche : le préfixe administratif est retiré, l’article conservé', () => {
  // « Ville de Bordeaux » désigne un cargo sur Wikidata, « Bordeaux » la ville et ses comptes
  assert.deepEqual(variantes('Ville de Bordeaux'), ['Ville de Bordeaux', 'Bordeaux']);
  // l'article est conservé pour une commune, sans quoi il resterait « Rochelle »
  assert.deepEqual(variantes('Ville de La Rochelle'), ['Ville de La Rochelle', 'La Rochelle']);
  // pour un département, « la Gironde » (un journal numérisé par Gallica) doit mener à « Gironde »
  assert.deepEqual(variantes('Département de la Gironde'), ['Département de la Gironde', 'la Gironde', 'Gironde']);
  assert.deepEqual(variantes('Département des Landes'), ['Département des Landes', 'Landes']);
  assert.ok(!variantes('Département des Landes').includes('ndes'), 'jamais de nom amputé');
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
  // rencontré en conditions réelles : « Morimoto » a retenu un compte personnel nommé « Morimoto🌱 »
  assert.ok(!nomExploitable('Morimoto'), 'un nom d’un seul mot ne permet aucune vérification');
  assert.ok(nomExploitable('Morimoto Bordeaux'));
  assert.deepEqual(variantesHandle('Morimoto Bordeaux').slice(0, 3), ['morimotobordeaux', 'morimoto_bordeaux', 'morimoto.bordeaux'], 'les formes les plus courantes d’abord');
  assert.deepEqual(variantesHandle('Morimoto'), [], 'aucun pseudo généré depuis un nom trop court');
  // 25/09/2026 : @ultratraildepons_officiel existait, était taguable, et n'était pas proposé — le
  // générateur perdait le « de » et ignorait le suffixe « officiel », très répandu en France.
  const pons = variantesHandle('Ultra Trail de Pons');
  assert.ok(pons.includes('ultratraildepons_officiel'), `absent : ${pons.join(', ')}`);
  assert.ok(pons.includes('ultratraildepons'), 'la forme qui garde les petits mots');
  assert.ok(pons.includes('ultratrailpons'), 'et celle qui les retire');
  assert.ok(pons.length <= 12, `${pons.length} candidats : chacun coûte un appel à Meta`);
  assert.ok(pons.every((h) => h.length <= 30), 'limite d’Instagram');
  assert.equal(new Set(pons).size, pons.length, 'aucun doublon à vérifier deux fois');
  assert.ok(correspond('Landes', { handle: 'departementlandes.bsky.social', nom: 'Département des Landes' }));
  // rencontré en conditions réelles : la fiche trouvée pour « Département de la Gironde » était Gallica,
  // ses comptes auraient été tagués à la place de ceux du Département
  assert.ok(!correspond('Département de la Gironde', { nom: 'Gallica' }));
  assert.ok(correspond('Gironde', { nom: 'Gironde' }), 'la variante sans préfixe reste acceptée');
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

test('plusieurs pseudos pour une entité : le plus suivi l’emporte', async () => {
  const { departager } = await import('../src/brain/comptes.mjs');
  const dit = [];
  const log = (m) => dit.push(m.trim());
  // 25/09/2026 : @ultratraildepons et @ultratraildepons_officiel existent tous deux et acceptent
  // d'être tagués. Meta prouve l'existence, jamais l'identité — il faut donc départager.
  const abonnes = { a: 120, b: 8400, c: null };
  assert.equal(await departager(['a', 'b'], 'X', log, async (h) => abonnes[h]), 'b', 'le plus suivi');
  assert.match(dit.at(-1), /8400 abonnés/);

  // un compte personnel ne publie pas ses abonnés : on retient celui qui se déclare officiel
  dit.length = 0;
  const muet = async () => null;
  assert.equal(await departager(['ultratraildepons', 'ultratraildepons_officiel'], 'Ultra Trail de Pons', log, muet), 'ultratraildepons_officiel');
  assert.match(dit.at(-1), /seul à se déclarer officiel/);

  // un seul compte connu face à des muets : il l'emporte, un chiffre vaut mieux qu'aucun
  assert.equal(await departager(['c', 'a'], 'X', () => {}, async (h) => abonnes[h]), 'a');

  // rien ne tranche : aucune mention plutôt qu'une mention au hasard
  dit.length = 0;
  assert.equal(await departager(['unetruc', 'autretruc'], 'X', log, muet), null);
  assert.match(dit.at(-1), /pas de mention/);
});
