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

test('la sélection : le sujet et la ville à chaque fois, un seul compte non concerné, jamais deux fois de suite', () => {
  const c = (handle, echelon) => ({ handle, echelon, thematique: echelon !== 'sujet' });
  // mêmes viviers sur chaque réseau, pour comparer les plafonds
  const echelons = (sujet, commune, domaine = [], territoire = []) => {
    const pour = (v) => ({ instagram: v, threads: v, bluesky: v, x: v });
    return {
      sujet: pour([sujet.map((h) => c(h, 'sujet'))]),
      commune: pour([commune.map((h) => c(h, 'commune'))]),
      domaine: pour(domaine.map((v) => v.map((h) => c(h, 'domaine')))),
      territoire: pour([territoire.map((h) => c(h, 'territoire'))]),
    };
  };
  const choix = (e, opts = {}, reseau = 'instagram') => selectionner(e, opts)[reseau].map((x) => x.handle);

  // Bègles, 05/10/2026 : le festival et ses têtes d'affiche, puis la ville — et plus France Musique
  const begles = echelons(['greenparadizefest', 'cerroneofficial', 'morcheebaband'], ['villedebegles'], [], ['departementgironde']);
  assert.deepEqual(choix(begles), ['greenparadizefest', 'cerroneofficial', 'morcheebaband', 'villedebegles', 'departementgironde'], 'Instagram : cinq tags, un seul compte non concerné en dernier');
  assert.deepEqual(choix(begles, {}, 'threads'), ['greenparadizefest', 'cerroneofficial', 'villedebegles'], 'Threads : trois, une place gardée pour la ville, aucun compte non concerné');
  // un sujet foisonnant ne chasse jamais la ville
  assert.deepEqual(choix(echelons(['a', 'b', 'c', 'd', 'e'], ['villedebegles'])), ['a', 'b', 'c', 'd', 'villedebegles']);

  // Hendaye, 04/10/2026 : la ville et son office (sujet de visiteurs), plus jamais trois comptes génériques
  assert.deepEqual(
    choix(echelons([], ['villehendaye64700', 'hendaye_tourisme_et_commerce'], [], ['paysbasque_net', 'bienvenue_au_pays_basque'])),
    ['villehendaye64700', 'hendaye_tourisme_et_commerce', 'paysbasque_net'],
  );

  // le flood : un compte non concerné ne revient pas à l'article suivant, et la rotation sert le moins récent
  const patrimoine = echelons(['chateaudebidache'], ['villedebidache'], [['fondationdupatrimoine'], ['histoirefrance']]);
  assert.deepEqual(choix(patrimoine), ['chateaudebidache', 'villedebidache', 'fondationdupatrimoine']);
  assert.deepEqual(choix(patrimoine, { dernier: { instagram: ['fondationdupatrimoine'] }, recents: { instagram: ['fondationdupatrimoine'] } }), ['chateaudebidache', 'villedebidache', 'histoirefrance']);
  // seul candidat, et déjà au dernier article : la place reste vide plutôt que de le répéter
  assert.deepEqual(choix(echelons([], ['villedepoitiers'], [['fondationdupatrimoine']]), { dernier: { instagram: ['fondationdupatrimoine'] } }), ['villedepoitiers']);

  // la ville n'est pas retaguée deux articles de suite ; le sujet, lui, toujours
  const bordeaux = echelons(['fabfestivalbdx'], ['villedebordeaux'], [['moulinrougeofficiel']]);
  assert.deepEqual(choix(bordeaux, { dernier: { instagram: ['villedebordeaux', 'fabfestivalbdx'] } }), ['fabfestivalbdx', 'moulinrougeofficiel']);

  // Cognac : le vivier ancré dans le lieu passe avant le vivier général
  assert.deepEqual(choix(echelons([], ['villedecognac'], [['cognac_official', 'lartducognac'], ['vinsdebordeaux']])), ['villedecognac', 'cognac_official']);
  // X : un compte non concerné au plus, comme Instagram ; Bluesky aucun
  assert.deepEqual(choix(patrimoine, {}, 'x'), ['chateaudebidache', 'villedebidache', 'fondationdupatrimoine']);
  assert.deepEqual(choix(patrimoine, {}, 'bluesky'), ['chateaudebidache', 'villedebidache']);
});

test('l’entité cherchée : la commune pour un lieu d’un seul mot, le nom seul pour un artiste', async () => {
  const { aChercher } = await import('../src/brain/comptes.mjs');
  // « Le Cheverny » se cherche « Le Cheverny Limoges » (@lechevernylimoges), mais le nom écrit
  // dans l'article reste celui que Bluesky et Threads remplacent par la mention
  assert.deepEqual(aChercher({ nom: 'Le Cheverny', role: 'sujet', type: 'lieu' }, 'Limoges'), { nom: 'Le Cheverny Limoges', role: 'sujet', type: 'lieu', nomFixe: 'Le Cheverny', seul: false });
  assert.equal(aChercher({ nom: 'Le Cheverny Limoges', type: 'lieu' }, 'Limoges').nom, 'Le Cheverny Limoges', 'jamais la ville en double');
  assert.equal(aChercher({ nom: 'Cerrone', type: 'artiste' }, 'Bègles').seul, false, 'un artiste d’un seul mot se cherche, par ses formes propres');
  assert.equal(aChercher({ nom: 'Hermione', type: 'evenement' }, 'Bayonne').seul, true, 'un événement d’un seul mot reste réservé à la fiche');
});

test('artistes et festivals : leurs formes propres, et le juste compte', async () => {
  const { variantesTypees, pseudosDuDomaine, estLArtiste } = await import('../src/brain/identite.mjs');
  assert.ok(variantesTypees('Green Paradize Festival', { type: 'evenement' }).includes('greenparadizefest'));
  assert.ok(pseudosDuDomaine('https://greenparadizefestival.com/').includes('greenparadizefest'));
  assert.ok(variantesTypees('Cerrone', { type: 'artiste' }).includes('cerroneofficial'));
  assert.ok(variantesTypees('Morcheeba', { type: 'artiste' }).includes('morcheebaband'));
  assert.deepEqual(variantesTypees('Cerrone', { type: 'lieu' }), [], 'rien de propre à un lieu');
  // un prénom en plus dans le nom affiché est admis ; une petite audience ou un compte de fans, non
  assert.ok(estLArtiste('Cerrone', { nom: 'Marc Cerrone', abonnes: 116882 }));
  assert.ok(!estLArtiste('Cerrone', { nom: 'Cerrone', abonnes: 900 }), 'un mot seul exige une audience d’artiste');
  assert.ok(!estLArtiste('Morcheeba', { nom: 'Morcheeba fans', abonnes: 20000 }));
  assert.ok(estLArtiste('Purple Disco Machine', { nom: 'Purple Disco Machine', abonnes: 1500 }));

  // de bout en bout : le festival par son site, les artistes par leurs formes, avec de vraies données
  const begles = faux({
    liens: { sites: ['https://greenparadizefestival.com/'], instagram: [] },
    comptes: {
      greenparadizefest: ig('greenparadizefest', 'Green Paradize Festival 🪩', 6851, '', 'http://www.greenparadizefestival.com'),
      cerroneofficial: ig('cerroneofficial', 'Marc Cerrone', 116882, '', 'https://www.fanbase.to/Cerrone'),
      morcheebaband: ig('morcheebaband', 'Morcheeba', 78561, 'English band', 'https://morcheeba.uk/pages/shows'),
    },
  });
  const liens = await begles.liensArticle();
  const fest = await identifier({ nom: 'Green Paradize Festival', role: 'sujet', type: 'evenement' }, { liens, outils: begles });
  assert.deepEqual(fest.instagram.map((x) => x.handle), ['greenparadizefest']);
  assert.equal(fest.instagram[0].preuve, PREUVE.DECLAREE, 'il renvoie au site que l’article cite');
  const cerrone = await identifier({ nom: 'Cerrone', role: 'acteur', type: 'artiste', seul: false }, { liens, outils: begles });
  assert.deepEqual(cerrone.instagram.map((x) => x.handle), ['cerroneofficial']);
  const morcheeba = await identifier({ nom: 'Morcheeba', role: 'acteur', type: 'artiste', seul: false }, { liens, outils: begles });
  assert.deepEqual(morcheeba.instagram.map((x) => x.handle), ['morcheebaband'], 'biographie anglaise admise pour un artiste');
});

test('Hendaye : la ville par son vrai site quand la fiche Wikidata ne mène nulle part', async () => {
  const outils = faux({
    // relevé le 06/10/2026 : la fiche indique hendaye.com, qui ne répond plus
    fiches: { Hendaye: { label: 'Hendaye', site: 'http://www.hendaye.com' } },
    sites: {
      'https://www.hendaye.fr/': { insta: ['villehendaye64700'] },
      'https://www.hendaye-tourisme.fr/': { insta: ['hendaye_tourisme_et_commerce'] },
    },
    comptes: {
      villehendaye64700: ig('villehendaye64700', 'Ville d’Hendaye 🐳', 6233, '', 'http://www.hendaye.fr'),
      hendaye_tourisme_et_commerce: ig('hendaye_tourisme_et_commerce', 'Hendaye Tourisme & Commerce', 11689, '', 'http://www.hendaye-tourisme.fr'),
    },
  });
  const mairie = await identifierCommune('Hendaye', { departement: 'Pyrénées-Atlantiques', outils });
  assert.deepEqual(mairie.instagram.map((x) => x.handle), ['villehendaye64700']);
  assert.equal(mairie.instagram[0].preuve, PREUVE.DECLAREE, 'le compte renvoie au site où il a été trouvé');
  const office = await identifierCommune('Hendaye', { departement: 'Pyrénées-Atlantiques', nature: 'tourisme', outils });
  assert.deepEqual(office.instagram.map((x) => x.handle), ['hendaye_tourisme_et_commerce']);

  // sur un site deviné, le nom de la commune seul ne suffit pas : une entreprise peut le porter
  const homonyme = faux({
    sites: { 'https://www.pons.fr/': { insta: ['pons_mobilier'] } },
    comptes: { pons_mobilier: ig('pons_mobilier', 'Pons', 8000, 'Mobilier de bureau', 'https://www.pons.fr') },
  });
  assert.deepEqual((await identifierCommune('Pons', { outils: homonyme })).instagram, []);
});

test('X : jamais le seul compte affiché par un site s’il ne porte pas le nom', async () => {
  // 24/09/2026 : le site de l'Ultra Trail de Pons n'affichait que @RaccourciAgency, son agence web
  const pons = faux({
    liens: { sites: ['https://ultratraildepons.fr/'], instagram: [] },
    sites: { 'https://ultratraildepons.fr/': { insta: ['ultratraildepons_officiel'], x: ['RaccourciAgency'] } },
    comptes: { ultratraildepons_officiel: ig('ultratraildepons_officiel', 'Ultra Trail de Pons', 2400) },
  });
  const r = await identifier({ nom: 'Ultra Trail de Pons', role: 'sujet', type: 'evenement' }, { liens: await pons.liensArticle(), outils: pons });
  assert.deepEqual(r.x, []);
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
  assert.equal(sain.memoire['commune:mairie:bergerac'].v, 3);
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
