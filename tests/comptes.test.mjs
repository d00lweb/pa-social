import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resoudreComptes, selectionner, parFamille } from '../src/brain/comptes.mjs';
import { identifier, identifierCommune, siteCite, porteLeNom, pseudosBluesky, pseudosDuDomaine, variantesHandle } from '../src/brain/identite.mjs';
import { retenir, referenceDuDomaine, semblFrancais, PREUVE } from '../src/brain/decouverte.mjs';
import { couverture, placerMentions } from '../src/brain/annuaire.mjs';
import { extractHandles, domaine, libelle } from '../src/sources/site.mjs';
import { extraireLiens } from '../src/sources/article.mjs';

// Tous les comptes ci-dessous ont été rencontrés en interrogeant les API le 25/09/2026. Les outils
// sont simulés : ces tests ne touchent ni Instagram, ni Bluesky, ni Wikidata, ni l'état du projet.

const ig = (handle, nom, abonnes, description = 'Compte officiel', site = null) => ({ handle, nom, abonnes, description, site });

function faux({ fiches = {}, sites = {}, comptes = {}, existent = [], bluesky = {}, threads = [], recherche = {}, liens = null, incertains = [] } = {}) {
  const suivi = { incertain: false };
  const appels = { decrire: [], existe: [] };
  const outils = {
    suivi,
    appels,
    fiche: async (nom, contexte, { partiel = false } = {}) => fiches[`${nom}${partiel ? '~' : ''}`] ?? fiches[nom] ?? null,
    site: async (url) => ({ insta: [], x: [], facebook: [], bluesky: [], threads: [], ...(sites[url] ?? {}) }),
    decrire: async (h) => {
      appels.decrire.push(h);
      if (incertains.includes(h)) { suivi.incertain = true; return undefined; }
      return comptes[h] ?? null;
    },
    existe: async (h) => { appels.existe.push(h); return existent.includes(h); },
    profilBluesky: async (h) => bluesky[h] ?? null,
    chercherBluesky: async (q) => recherche[q] ?? [],
    surThreads: async (h) => threads.includes(h),
    liensArticle: async () => liens ?? { sites: [], instagram: [] },
    memoire: {},
    async charger() { return this.memoire; },
    async enregistrer(v) { this.memoire = v; },
  };
  return outils;
}

test('la commune : sa fiche et son site déclarent ses comptes, les formes ne sont qu’un recours', async () => {
  // @villedebergerac manquait : aucune forme « villede{X} ». La fiche Wikidata le déclare.
  const outils = faux({
    fiches: { Bergerac: { label: 'Bergerac', insta: 'villedebergerac', x: 'VilledeBergerac', site: 'http://www.bergerac.fr' } },
    comptes: { villedebergerac: ig('villedebergerac', 'Ville de Bergerac', 19581, 'Compte Insta officiel de la Ville de Bergerac', 'http://www.bergerac.fr/') },
    bluesky: { 'villedebergerac.bsky.social': { handle: 'villedebergerac.bsky.social', nom: 'Ville de Bergerac', description: 'Compte officiel Bluesky de la Ville de Bergerac en Dordogne.', abonnes: 125 } },
    threads: ['villedebergerac'],
  });
  const r = await identifierCommune('Bergerac', { departement: 'Dordogne', outils });
  assert.deepEqual(r.instagram.map((c) => c.handle), ['villedebergerac']);
  assert.equal(r.instagram[0].preuve, PREUVE.DECLAREE);
  assert.deepEqual(r.bluesky.map((c) => c.handle), ['villedebergerac.bsky.social'], 'le jumeau Bluesky, introuvable par la recherche');
  assert.deepEqual(r.threads.map((c) => c.handle), ['villedebergerac']);
  assert.deepEqual(r.x.map((c) => c.handle), ['VilledeBergerac']);
  assert.equal(outils.appels.decrire.length, 1, 'aucune forme essayée : la fiche a suffi');

  // Hossegor : la fiche s'appelle Soorts-Hossegor, et son site déclare @villedesoortshossegor
  const hossegor = faux({
    fiches: { 'Hossegor~': { label: 'Soorts-Hossegor', site: 'https://www.soorts-hossegor.fr/' } },
    sites: { 'https://www.soorts-hossegor.fr/': { insta: ['villedesoortshossegor'] } },
    comptes: { villedesoortshossegor: ig('villedesoortshossegor', 'Soorts-Hossegor', 10155, 'Compte officiel de la ville de Soorts-Hossegor') },
  });
  assert.deepEqual((await identifierCommune('Hossegor', { departement: 'Landes', outils: hossegor })).instagram.map((c) => c.handle), ['villedesoortshossegor']);

  // l'office de tourisme, par les formes, et son nom affiché peut être son pseudo collé
  const tourisme = faux({ comptes: { visitbordeaux: ig('visitbordeaux', 'visitbordeaux', 118223, 'Bienvenue à Bordeaux, destination de charme') } });
  assert.deepEqual((await identifierCommune('Bordeaux', { nature: 'tourisme', outils: tourisme })).instagram.map((c) => c.handle), ['visitbordeaux']);

  // et le piège de La Rochelle reste fermé : un domaine événementiel brésilien, bâti sur la forme « ville{X} »
  const bresil = faux({ comptes: { villelarochelle: ig('villelarochelle', 'VILLE LA ROCHELLE | Locação para Eventos', 92295, 'Uma propriedade familiar no estilo europeu para eventos no interior de São Paulo') } });
  assert.deepEqual((await identifierCommune('La Rochelle', { outils: bresil })).instagram, []);
});

test('une entité : ce qu’elle déclare d’abord, ce qu’on construit ensuite, jamais un inconnu', async () => {
  // L'article cite ultratraildepons.fr : ce site déclare @ultratraildepons_officiel, compte
  // personnel que l'API ne décrit pas. L'essai d'identification confirme qu'il existe.
  const pons = faux({
    liens: { sites: ['https://ultratraildepons.fr/'], instagram: [] },
    sites: { 'https://ultratraildepons.fr/': { insta: ['ultratraildepons_officiel'] } },
    existent: ['ultratraildepons_officiel', 'ultratraildepons'],
  });
  const liens = await pons.liensArticle();
  const r = await identifier({ nom: 'Trail de la ville de Pons', role: 'sujet' }, { liens: { sites: ['https://ultratraildepons.fr/'] }, image: 'https://x/i.jpg', outils: pons });
  assert.equal(siteCite('Ultra Trail de Pons', liens.sites), 'https://ultratraildepons.fr/');
  assert.equal(siteCite('Trail de la ville de Pons', liens.sites), null, 'une adresse qui n’épelle pas le nom ne compte pas');
  assert.deepEqual(r.instagram.map((c) => c.handle), [], 'sans site ni fiche, un compte personnel inconnu n’est pas retenu sur la seule existence d’une forme voisine');
  const juste = await identifier({ nom: 'Ultra Trail de Pons', role: 'sujet' }, { liens, image: 'https://x/i.jpg', outils: pons });
  assert.deepEqual(juste.instagram.map((c) => c.handle), ['ultratraildepons_officiel'], 'déclaré par son site : un seul compte, plus de doute');

  // le nom porté par le domaine du site officiel : bdangouleme.com → @bdangouleme
  const bd = faux({
    fiches: { 'Festival international de la bande dessinée d’Angoulême': { label: 'Festival international de la bande dessinée d’Angoulême', site: 'https://www.bdangouleme.com' } },
    comptes: { bdangouleme: ig('bdangouleme', 'Festival de la BD d’Angoulême', 78801, '') },
  });
  const festival = await identifier({ nom: 'Festival international de la bande dessinée d’Angoulême', role: 'sujet' }, { outils: bd });
  assert.deepEqual(festival.instagram.map((c) => c.handle), ['bdangouleme'], 'biographie vide, mais deux mots propres en commun avec le nom');

  // le même raisonnement ne doit pas taguer un inconnu : @hermione n'a qu'un mot en commun
  const hermione = faux({
    fiches: { 'Hermione Voyage': { label: 'Hermione Voyage', site: 'https://hermione.com' } },
    comptes: { hermione: ig('hermione', 'Hermione', 5000, 'Photographe') },
  });
  assert.deepEqual((await identifier({ nom: 'Hermione Voyage', role: 'sujet' }, { outils: hermione })).instagram, []);

  // un compte des tables qui porte le nom : « TER Nouvelle-Aquitaine » est @sncf.ter.nouvelle.aquitaine,
  // et le compte personnel @ternouvelleaquitaine, dont on ignore qui le tient, n'est même pas essayé
  const ter = faux({ comptes: { 'sncf.ter.nouvelle.aquitaine': ig('sncf.ter.nouvelle.aquitaine', 'TER Nouvelle-Aquitaine', 8431) }, existent: ['ternouvelleaquitaine'] });
  const train = await identifier({ nom: 'TER Nouvelle-Aquitaine', role: 'sujet' }, { image: 'https://x/i.jpg', outils: ter });
  assert.deepEqual(train.instagram.map((c) => c.handle), ['sncf.ter.nouvelle.aquitaine']);
  assert.deepEqual(ter.appels.existe, [], 'aucun essai d’identification quand un compte vérifié répond');

  // Miroir d'eau : un homonyme décrit puis écarté (43 abonnés) ne revient pas par l'essai d'identification
  const miroir = faux({ comptes: { miroirdeau: ig('miroirdeau', 'Miroir d’eau', 43) }, existent: ['miroirdeau', 'miroir_d_eau'] });
  const eau = await identifier({ nom: 'Miroir d’eau', role: 'sujet' }, { image: 'https://x/i.jpg', outils: miroir });
  assert.ok(!eau.instagram.some((c) => c.handle === 'miroirdeau'));
});

test('le jugement se règle sur la preuve : ce que l’entité déclare n’est pas redemandé', () => {
  const petit = { handle: 'lartducognac', nom: 'L’art du Cognac', description: '📍Vignoble de Cognac', abonnes: 422 };
  assert.match(retenir(petit, { domaine: 'cognac', reseau: 'instagram' }).motif, /422 abonnés/);
  assert.deepEqual(retenir(petit, { domaine: 'cognac', reseau: 'instagram', preuve: PREUVE.DECLAREE }), { garde: true, motif: null });
  // jamais, même déclaré : le contenu pour adultes et les domaines nationaux étrangers
  assert.equal(retenir({ handle: 'x.de', nom: 'X', description: 'y', abonnes: 1e6 }, { preuve: PREUVE.DECLAREE }).garde, false);

  // une référence nationale se nomme par son domaine
  assert.ok(referenceDuDomaine('santé', { nom: 'Santé publique France' }));
  assert.ok(referenceDuDomaine('randonnée', { nom: 'Fédération française de la randonnée pédestre' }));
  assert.ok(referenceDuDomaine('livre', { nom: 'CNL - Centre national du livre' }));
  assert.ok(!referenceDuDomaine('santé', { nom: 'Espace Santé Trans' }), 'hors sujet sous la fermeture d’une maternité');
  assert.ok(!referenceDuDomaine('santé', { nom: 'Winslow Santé Publique' }));
  assert.ok(!referenceDuDomaine('culture', { nom: 'JV - Culture Jeu Vidéo' }));

  // la langue : compter, pas seulement repérer. « há mentes livres » passait grâce à un seul « de ».
  assert.equal(semblFrancais('A revolução é fruto de um povo oprimido. mensagens'), false);
  assert.equal(semblFrancais('Revue bilingue spécialisée en #HistoireDuLivre | Open access bilingual journal specializing in #BookHistory'), false);
  // l'ancrage local tolère l'anglais des écoles de surf, jamais le portugais
  assert.equal(semblFrancais('Club & Surf School since 1994 Surf Lessons', { local: true }), true);
  assert.equal(semblFrancais('Club & Surf School since 1994 Surf Lessons'), false);
  assert.equal(semblFrancais('Uma propriedade familiar para eventos', { local: true }), false);
});

test('pseudos, adresses et noms : les rapprochements qui prouvent', () => {
  assert.equal(couverture('ultratraildepons', 'Ultra Trail de Pons'), 1);
  assert.ok(couverture('transports.nouvelle-aquitaine', 'TER Nouvelle-Aquitaine') < 0.8);
  assert.ok(porteLeNom('moulinrougeofficiel', 'Moulin Rouge'));
  assert.ok(!porteLeNom('en_nouvelle_aquitaine', 'TER Nouvelle-Aquitaine'), 'sans « TER », c’est la marque touristique de la région');
  assert.ok(!porteLeNom('vinsdebordeaux', 'Bordeaux'));
  assert.deepEqual(pseudosDuDomaine('http://huitres-arcachon-capferret.fr/'), ['huitresarcachoncapferret', 'huitres_arcachon_capferret', 'huitres.arcachon.capferret']);
  assert.deepEqual(pseudosBluesky('ville_pau'), ['villepau.bsky.social', 'ville-pau.bsky.social'], 'Bluesky n’admet ni « _ » ni « . »');
  assert.ok(pseudosBluesky('ripitup.fr').includes('ripitup.fr'), 'un pseudo en forme de domaine est essayé tel quel');
  assert.ok(variantesHandle('Opéra National de Bordeaux').includes('operadebordeaux'), 'les adjectifs d’institution tombent souvent du pseudo');
  assert.equal(domaine('http://www.bergerac.fr/'), 'bergerac.fr');
  assert.equal(domaine('https://linktr.ee/les_landes'), null, 'une plateforme ne prouve rien');
  assert.equal(libelle('https://fab.festivalbordeaux.com/spectacle/'), 'fab.festivalbordeaux');
  assert.deepEqual(parFamille([
    { handle: 'fneidf.bsky.social', abonnes: 878 }, { handle: 'fne.asso.fr', abonnes: 5048 }, { handle: 'fne85.bsky.social', abonnes: 491 }, { handle: 'frbiodiv.bsky.social', abonnes: 2392 },
  ]).map((c) => c.handle), ['fne.asso.fr', 'frbiodiv.bsky.social'], 'une organisation, une mention');
});

test('les liens : sites et comptes lus sans se tromper d’adresse', () => {
  // « festivalbordeaux.com/xmlrpc » se lisait « x.com/xmlrpc » : onze comptes X imaginaires
  const h = extractHandles('<a href="https://fab.festivalbordeaux.com/xmlrpc.php">a</a> <a href="https://x.com/fabfestivalbdx">b</a> <a href="https://www.instagram.com/FabFestivalBdx/">c</a> <a href="https://bsky.app/profile/villedebordeaux.bsky.social">d</a> <a href="https://www.threads.com/@villedebordeaux">e</a>');
  assert.deepEqual(h.x, ['fabfestivalbdx']);
  assert.deepEqual(h.insta, ['fabfestivalbdx'], 'la casse d’un pseudo Instagram ne compte pas');
  assert.deepEqual(h.bluesky, ['villedebordeaux.bsky.social']);
  assert.deepEqual(h.threads, ['villedebordeaux']);

  // l'article : les sources citées, sans les comptes du média ni les liens de partage
  const page = `<header><a href="https://www.instagram.com/lovaquitaine/">nous</a></header><article>
    <a href="https://ultratraildepons.fr/">site</a> <a href="https://www.facebook.com/sharer/sharer.php?u=x">partager</a>
    <a href="https://www.instagram.com/lovaquitaine/">nous</a> <a href="https://passion-aquitaine.ouest-france.fr/autre">autre</a>
  </article><footer><a href="https://www.instagram.com/lovaquitaine/">nous</a></footer>`;
  assert.deepEqual(extraireLiens(page), { sites: ['https://ultratraildepons.fr/'], instagram: [] });
});

test('l’équilibre : le sujet, puis une place pour la commune et une pour le domaine', () => {
  const c = (handle, echelon) => ({ handle, echelon, thematique: echelon !== 'sujet' });
  const echelons = (sujet, commune, domaine, territoire = []) => ({
    sujet: { instagram: [sujet.map((h) => c(h, 'sujet'))] },
    commune: { instagram: [commune.map((h) => c(h, 'commune'))] },
    domaine: { instagram: domaine.map((v) => v.map((h) => c(h, 'domaine'))) },
    territoire: { instagram: [territoire.map((h) => c(h, 'territoire'))] },
  });
  const choix = (e, recents = []) => selectionner(e, { recents }).instagram.map((x) => x.handle);

  // French Cancan au FAB : le festival, la ville, le Moulin Rouge — pas l'office de tourisme d'abord
  assert.deepEqual(choix(echelons(['fabfestivalbdx'], ['villedebordeaux', 'visitbordeaux'], [['moulinrougeofficiel']])), ['fabfestivalbdx', 'villedebordeaux', 'moulinrougeofficiel']);
  // l'Hermione à Bayonne, sans référence de domaine : la ville et son office avant le Pays basque
  assert.deepEqual(choix(echelons(['hermione_lafayette'], ['bayonnemaville', 'visitbayonne'], [], ['paysbasque_tourisme'])), ['hermione_lafayette', 'bayonnemaville', 'visitbayonne']);
  // Cognac : le vivier ancré dans le lieu avant le vivier général du vin
  assert.deepEqual(choix(echelons([], ['villedecognac'], [['cognac_official', 'lartducognac'], ['vinsdebordeaux']])), ['villedecognac', 'cognac_official', 'lartducognac']);
  // la rotation fait tourner la commune d'un article à l'autre, jamais le sujet
  assert.deepEqual(choix(echelons(['fabfestivalbdx'], ['villedebordeaux', 'visitbordeaux'], [['moulinrougeofficiel']]), ['villedebordeaux']), ['fabfestivalbdx', 'visitbordeaux', 'moulinrougeofficiel']);
  // trois sujets : aucune place pour le reste
  assert.deepEqual(choix(echelons(['a', 'b', 'c'], ['villedebordeaux'], [['moulinrougeofficiel']])), ['a', 'b', 'c']);
});

test('mémoire des recherches : le doute ne se mémorise jamais comme une absence', async () => {
  // Un quota dépassé pendant la recherche de Bergerac laissait croire que la ville n'avait aucun
  // compte, et ce « rien » aurait été gardé 90 jours.
  const panne = faux({ fiches: { Bergerac: { label: 'Bergerac', insta: 'villedebergerac' } }, incertains: ['villedebergerac'] });
  await resoudreComptes([], { commune: 'Bergerac', departement: 'Dordogne', outils: panne });
  assert.equal(panne.memoire['commune:mairie:bergerac'], undefined, 'rien de mémorisé');

  const sain = faux({ fiches: { Bergerac: { label: 'Bergerac', insta: 'villedebergerac' } }, comptes: { villedebergerac: ig('villedebergerac', 'Ville de Bergerac', 19581) } });
  sain.memoire = { 'commune:mairie:bergerac': { cherche: '2026-09-25T00:00:00Z', instagram: [] } };
  const plan = await resoudreComptes([], { commune: 'Bergerac', departement: 'Dordogne', outils: sain });
  assert.deepEqual(plan.instagram.map((c) => c.handle).slice(0, 1), ['villedebergerac'], 'une recherche d’une version précédente est refaite');
  assert.equal(sain.memoire['commune:mairie:bergerac'].v, 2);
  assert.equal(plan.instagram[0].thematique, true, 'la commune entre dans la rotation');
});

test('mentions Bluesky et Threads : trois au plus, le nom remplacé, les autres en dernière ligne', () => {
  const comptes = [
    { nom: 'Festival de la BD', handle: 'bdangouleme.bsky.social' },
    { nom: 'Angoulême', handle: 'villeangouleme.bsky.social', thematique: true },
    { nom: 'bande dessinée', handle: 'citebd.bsky.social', thematique: true },
    { nom: 'x', handle: 'quatrieme.bsky.social', thematique: true },
  ];
  const { texte, places } = placerMentions('Le Festival de la BD dévoile sa sélection.', comptes);
  assert.equal(texte, 'Le @bdangouleme.bsky.social dévoile sa sélection.\n@villeangouleme.bsky.social @citebd.bsky.social');
  assert.equal(places.length, 3, 'jamais plus de trois');
  // un nom de domaine n'est jamais remplacé en plein texte, et le texte prime sur les mentions
  const court = placerMentions('Sélection de bande dessinée.', comptes.slice(2), { tient: (t) => t.length <= 60 });
  assert.equal(court.texte, 'Sélection de bande dessinée.\n@citebd.bsky.social');
  assert.equal(placerMentions('Texte', comptes, { tient: (t) => t.length <= 5 }).places.length, 0);
});
