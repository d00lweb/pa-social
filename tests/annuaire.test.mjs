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

test('plusieurs pseudos pour une entité : les deux meilleurs, les miettes écartées', async () => {
  const { garderLesMeilleurs, AUDIENCE_MINIMALE } = await import('../src/brain/comptes.mjs');
  const dit = [];
  const log = (m) => dit.push(m.trim());
  const abonnes = { petit: 43, moyen: 800, gros: 50000, muet1: null, muet2: null, muet_officiel: null };
  const mesurer = async (h) => abonnes[h] ?? null;

  // 25/09/2026 : « Miroir d'eau » a produit trois pseudos dont un à 43 abonnés. Tous tagués, ils
  // occupaient les trois places et évinçaient les comptes de référence, qui pèsent cent fois plus.
  assert.deepEqual(await garderLesMeilleurs(['petit', 'moyen', 'gros'], 'X', log, mesurer), ['gros', 'moyen'], 'les deux plus suivis');
  assert.ok(dit.at(-1).includes('écartés @petit (43 abonnés)'), dit.at(-1));
  assert.equal(AUDIENCE_MINIMALE, 100, 'en dessous, un compte n’apporte rien');

  // deux au maximum : la troisième place revient à un compte de référence
  assert.equal((await garderLesMeilleurs(['gros', 'moyen', 'muet1', 'muet2'], 'X', () => {}, mesurer)).length, 2);

  // comptes personnels, tous muets : celui qui se déclare officiel passe devant, et les deux sont
  // tagués — chacun peut décider de suivre à son tour. C'est le cas de l'Ultra Trail de Pons.
  assert.deepEqual(
    await garderLesMeilleurs(['ultratraildepons', 'ultratraildepons_officiel'], 'Ultra Trail de Pons', () => {}, async () => null),
    ['ultratraildepons_officiel', 'ultratraildepons'],
  );

  // tous sous le seuil : plutôt que de ne rien taguer, on garde le premier candidat
  assert.deepEqual(await garderLesMeilleurs(['petit'], 'X', () => {}, mesurer), ['petit']);
});

test('comptes de référence d’un thème : seulement si l’article parle vraiment du sujet', async () => {
  const { comptesThematiques } = await import('../src/brain/comptes.mjs');
  const table = { trail: { motsCles: ['trail', 'traileur'], instagram: ['lestraileurs', 'trail.passion'], bluesky: [] } };
  const pons = 'En Charente-Maritime, nouveau succès pour l’Ultra Trail de Pons. 2 740 inscrits. Sport';
  assert.deepEqual(comptesThematiques(pons, 'instagram', table).map((c) => c.handle), ['lestraileurs', 'trail.passion']);
  // le thème ne se force pas : une course qui ne dit jamais « trail » n'appelle pas ces comptes
  assert.deepEqual(comptesThematiques('Cette course de 80 km traverse le Périgord. Sport', 'instagram', table), []);
  assert.deepEqual(comptesThematiques('Près de Limoges, on dort au milieu des girafes', 'instagram', table), []);
  // mot entier seulement : « traileur » compte, « retail » non
  assert.equal(comptesThematiques('Le traileur bordelais termine 3e', 'instagram', table).length, 2);
  assert.deepEqual(comptesThematiques('Le retail se porte bien à Bordeaux', 'instagram', table), []);
  // un réseau sans compte de référence n'en invente pas
  assert.deepEqual(comptesThematiques(pons, 'bluesky', table), []);
  assert.deepEqual(comptesThematiques(pons, 'facebook', table), []);
  assert.deepEqual(comptesThematiques(null, 'instagram', table), []);
  // rôle « theme » : il distingue ces comptes de ceux que l'article nomme
  assert.equal(comptesThematiques(pons, 'instagram', table)[0].role, 'theme');
});

test('rotation des comptes de référence : jamais les mêmes deux fois de suite', async () => {
  const { rotation } = await import('../src/brain/comptes.mjs');
  const { retenirMentions } = await import('../src/brain/memory.mjs');
  // Mentionner toujours les deux mêmes comptes d'un thème, c'est parler chaque fois aux abonnés
  // déjà touchés : ceux qui devaient suivre l'ont fait au premier article. D'où la rotation.
  const vivier = ['a', 'b', 'c', 'd'].map((h) => ({ nom: 'train', handle: h, role: 'theme', thematique: true }));
  const memory = {};
  const tours = [];
  for (let i = 0; i < 4; i++) {
    const choisis = rotation(vivier, memory.mentions ?? [], 2);
    retenirMentions(memory, choisis);
    tours.push(choisis.map((c) => c.handle).join('+'));
  }
  assert.deepEqual(tours, ['a+b', 'c+d', 'a+b', 'c+d'], 'le vivier est parcouru avant de recommencer');
  assert.equal(memory.mentions.length, 8, 'chaque mention est retenue');

  // jamais mentionné passe devant ; à égalité, l'ordre du vivier tranche
  assert.deepEqual(rotation(vivier, ['a', 'b'], 2).map((c) => c.handle), ['c', 'd']);
  assert.deepEqual(rotation(vivier, ['d', 'c', 'b', 'a'], 2).map((c) => c.handle), ['d', 'c'], 'le plus anciennement mentionné d’abord');
  assert.deepEqual(rotation(vivier, [], 0), [], 'aucune place libre, aucun compte');
  assert.deepEqual(rotation([], ['a'], 3), []);

  // seuls les comptes de vivier entrent dans la mémoire : ceux que l'article nomme n'y sont pas,
  // sinon on s'interdirait de retaguer l'organisateur d'un événement qui revient chaque année
  const m = {};
  retenirMentions(m, [{ handle: 'ultratraildepons_officiel', role: 'sujet' }, { handle: 'lestraileurs', role: 'theme', thematique: true }]);
  assert.deepEqual(m.mentions, ['lestraileurs']);
});

test('le compte au cœur de l’article passe toujours avant les comptes de référence', async () => {
  const { comptesThematiques, rotation } = await import('../src/brain/comptes.mjs');
  // Le sujet de l'article n'est jamais évincé par la rotation : c'est lui que le lecteur cherche,
  // et c'est lui qui a le plus de raisons de relayer. Les comptes de référence comblent le reste.
  const MAX = 3;
  const table = { trail: { motsCles: ['trail'], instagram: ['lestraileurs', 'trail.passion', 'a', 'b'] } };
  const texte = 'l’Ultra Trail de Pons signe une édition record';
  const sujets = [{ nom: 'Ultra Trail de Pons', handle: 'ultratraildepons_officiel', role: 'sujet' }];
  const libres = comptesThematiques(texte, 'instagram', table);
  const final = [...sujets, ...rotation(libres, [], MAX - sujets.length)];
  assert.equal(final[0].handle, 'ultratraildepons_officiel', 'le sujet en premier');
  assert.equal(final.length, MAX);
  assert.equal(final.filter((c) => c.role === 'sujet').length, 1);

  // deux comptes pour le sujet : une seule place reste, et elle va au premier du vivier
  const deux = [...sujets, { nom: 'Ultra Trail de Pons', handle: 'ultratraildepons', role: 'sujet' }];
  const avecDeux = [...deux, ...rotation(libres, [], MAX - deux.length)];
  assert.deepEqual(avecDeux.map((c) => c.handle), ['ultratraildepons_officiel', 'ultratraildepons', 'lestraileurs']);

  // trois comptes pour le sujet : aucun compte de référence, le sujet occupe tout
  const trois = [...deux, { nom: 'X', handle: 'x', role: 'acteur' }];
  assert.deepEqual(rotation(libres, [], MAX - trois.length), [], 'plus aucune place');
});

test('un nom d’un seul mot se résout par la fiche, jamais par la devinette', async () => {
  const { variantesHandle } = await import('../src/brain/comptes.mjs');
  // 25/09/2026 : @troismatsbelem et @hermione_lafayette existaient, et le moteur ne les trouvait
  // pas. Le nom seul n'était même pas examiné — or c'est l'entité principale de l'article.
  assert.deepEqual(variantesHandle('Belem'), [], 'aucun pseudo deviné depuis un mot seul');
  assert.deepEqual(variantesHandle('Hermione'), []);
  // ce qui protège reste en place : @lebelem est un café bar, @belem_officiel une personne
  assert.ok(!variantesHandle('Belem').includes('lebelem'));
  // la voie sûre est la fiche officielle départagée par le contexte, puis son site
  const { fiche } = await import('../src/sources/wikidata.mjs');
  assert.equal(typeof fiche, 'function');
});
