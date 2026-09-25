import { fold } from './geo.mjs';
import { couverture } from './annuaire.mjs';
import { enParallele } from '../core/parallele.mjs';

// Jugement des comptes candidats, et formes de pseudos à essayer.
//
// Mesuré le 25/09/2026, sur quatre domaines, pour choisir la méthode :
//
//  · Fabriquer des pseudos depuis le mot du domaine et les soumettre à Instagram ne suffit pas.
//    « apiculture » donne 153 et 21 abonnés ; « féminisme » ne donne rien ; « patrimoine » donne
//    une boutique indonésienne à 1 300 abonnés. Un bon résultat sur quatre — et le mauvais est
//    pire que l'absence, puisqu'il paraît crédible.
//  · La recherche d'acteurs de Bluesky, elle, est une vraie recherche : « féminisme » renvoie
//    Osez le Féminisme, les Archives du féminisme, le Musée des féminismes.
//
// D'où cette conception : les sources proposent, et c'est le **jugement** qui décide. Il ne pose
// pas les mêmes questions à tous les candidats : il les pose selon ce qui prouve déjà l'identité.

// Ce qui prouve qu'un compte est bien celui qu'on croit, du plus sûr au moins sûr.
export const PREUVE = {
  // l'entité le déclare elle-même : table vérifiée à la main, fiche Wikidata, lien sur son site
  // officiel, site du compte qui renvoie au site de l'entité, domaine vérifié sur Bluesky
  DECLAREE: 3,
  // pseudo bâti sur le nom exact de l'entité, de la commune ou du domaine
  CONSTRUITE: 2,
  // résultat d'une recherche
  TROUVEE: 1,
};

// Audience minimale d'un compte de référence trouvé par forme ou par recherche. Un compte à 150
// abonnés n'apporte aucune découverte ; il signale surtout un homonyme ou un compte abandonné.
// Bluesky étant un réseau jeune, son seuil est plus bas : 300 abonnés y valent des milliers ailleurs.
export const SEUILS = { instagram: 3000, bluesky: 300 };
// Un compte ancré dans la commune de l'article (sa mairie, son club de surf) touche une audience
// proche du sujet : il vaut davantage à audience égale, son seuil est donc plus bas.
export const SEUILS_LOCAUX = { instagram: 1000, bluesky: 100 };

// Marques d'une autre langue dans une biographie. Relevées sur les cas réels : la boutique
// indonésienne (« Order via WA only: +628… »), les associations américaines et britanniques
// d'Alzheimer, un collectif norvégien de féminisme.
// Un nom français ne garantit rien : « Gastronomie France » (17 698 abonnés) est une agence de
// recrutement espagnole — « 10 AÑOS DE EXPERIENCIA, +900 candidatos ». C'est la **biographie**
// qui dit la langue, pas l'enseigne.
const ETRANGER = /\b(the|and|we|our|your|with|for|order|shop|worldwide|dementia|disease|society|beekeeping|bli med|vi bygger|inkluderende|años|experiencia|candidatos|establecimientos|nuestro|para|más|anos|nosso|unsere|wir)\b|\+\d{2,3}\s?\d{6,}/i;
// Marques de langue française. La présence d'au moins une suffit : les biographies sont courtes.
const FRANCAIS = /\b(le|la|les|des|du|de|au|aux|une|un|et|pour|avec|sur|dans|notre|nos|vous|votre|française?|france|par)\b|[éèêàçùôîï]/i;

// Francophone ne veut pas dire français : @sante.quebec a franchi les portes le 25/09/2026. Le
// média parle de Nouvelle-Aquitaine à un public de France ; une audience québécoise ou suisse ne
// se convertit pas en abonnés.
const HORS_DE_FRANCE = /\b(quebec|québec|canada|canadien|suisse|belgique|belge|luxembourg|maroc|tunisie|senegal|sénégal)\b/i;

// Portugais et espagnol passaient : @sagradalivre (astrologie, 2 573), @ksal-livre (compte
// adulte, 2 065) et @vitinhosurfista (Rio de Janeiro, 1 759) ont franchi les portes le
// 25/09/2026 parce que « livre » et « surf » sont aussi des mots français.
const LUSO_HISPANIQUE = /\b(somos|uma|voce|nao|muito|familia|escritora|obrigad\w*|brasil|nuestra|nuestros|gracias|hola)\b|\.com\.br\b|\.br\b|🇧🇷|🇵🇹|🇪🇸|🇮🇹|🇩🇪|🇬🇧|🇺🇸/i;
// Contenu pour adultes : jamais, à aucune condition. Un post de Passion Aquitaine qui mentionne
// un tel compte, c'est une capture d'écran qui circule et une réputation abîmée.
const ADULTE = /🔞|\b(onlyfans|privacy\.com|nsfw|hot|sexy|erotique|coquin\w*)\b/i;
// Les deux se testent sur le texte sans accents : « érotique » précédé d'un \b ne se reconnaît
// pas, l'accent n'étant pas un caractère de mot pour une expression régulière.
const sansAccents = (t) => String(t).normalize('NFD').replace(/\p{M}/gu, '');

// Mots propres à chaque langue. Une marque isolée ne suffisait pas : « há mentes livres »
// (« A revolução é fruto de um povo oprimido ») passait le 25/09/2026 grâce à un seul « de ».
// On compte donc, langue contre langue, les mots qui n'appartiennent qu'à l'une d'elles.
const MOTS = {
  francais: ['le', 'les', 'des', 'du', 'au', 'aux', 'une', 'et', 'pour', 'avec', 'sur', 'dans', 'notre', 'nos', 'vous', 'votre', 'vos', 'est', 'sont', 'qui', 'ce', 'cette', 'ces', 'ses', 'pas', 'par', 'chez', 'nous', 'ou', 'leur', 'leurs', 'tous', 'toutes', 'tout', 'sa', 'mon', 'ma', 'mes', 'je', 'elle', 'ils', 'aussi', 'depuis', 'entre', 'sans', 'sous', 'vers'],
  anglais: ['the', 'and', 'of', 'to', 'in', 'for', 'with', 'on', 'our', 'your', 'we', 'is', 'are', 'you', 'from', 'at', 'by', 'this', 'it', 'be', 'an', 'or', 'all', 'more', 'has', 'have', 'will', 'my', 'their', 'since', 'about'],
  espagnol: ['el', 'los', 'las', 'del', 'con', 'una', 'es', 'muy', 'pero', 'nuestro', 'nuestra', 'su', 'sus', 'al', 'lo', 'como', 'para', 'mas', 'por', 'somos'],
  portugais: ['um', 'uma', 'os', 'as', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nas', 'com', 'para', 'mais', 'seu', 'sua', 'voce', 'nao', 'muito', 'ao', 'pelo', 'pela'],
};
const LANGUES = Object.fromEntries(Object.entries(MOTS).map(([l, mots]) => [l, new Set(mots)]));

export function compterLangues(texte) {
  const jetons = sansAccents(texte).toLowerCase()
    // adresses, mentions et mots-dièse ne sont pas de la prose : « exemple.com » compterait « com »
    .replace(/\S*(?:https?:\/\/|www\.|\.[a-z]{2,4}\b)\S*|[@#]\S+/g, ' ')
    .split(/[^a-z]+/).filter(Boolean);
  const scores = Object.fromEntries(Object.keys(LANGUES).map((l) => [l, 0]));
  for (const j of jetons) {
    const langues = Object.keys(LANGUES).filter((l) => LANGUES[l].has(j));
    // un mot partagé (« para » en espagnol et en portugais) ne départage rien entre elles, mais
    // compte contre le français
    for (const l of langues) scores[l] += 1;
  }
  const { francais, anglais, ...latines } = scores;
  return { francais, anglais, latines: Math.max(0, ...Object.values(latines)), etranger: Math.max(anglais, ...Object.values(latines)) };
}

// `local` : le compte a prouvé son ancrage autrement, par son nom bâti sur celui de la commune.
// Une école de surf d'Hossegor écrit en anglais pour les vacanciers (« Surf School since 1994 »),
// le Festival de la BD d'Angoulême n'a pas de biographie : ni l'un ni l'autre n'est étranger.
// L'anglais y est donc toléré ; l'espagnol ou le portugais, qui trahissent un autre pays, jamais.
export const semblFrancais = (texte, { local = false } = {}) => {
  const t = String(texte ?? '');
  const nu = sansAccents(t);
  if (ADULTE.test(nu) || LUSO_HISPANIQUE.test(nu) || HORS_DE_FRANCE.test(t)) return false;
  const { francais, etranger, latines } = compterLangues(t);
  if ((local ? latines : etranger) > francais) return false;
  if (local) return true;
  if (!t.trim()) return false;
  return FRANCAIS.test(t) && !ETRANGER.test(t);
};

// Le compte est-il **du** domaine, ou seulement quelqu'un qui en parle ? Le mot doit figurer dans
// son **nom**, pas seulement dans sa biographie. C'est la porte qui sépare une institution d'un
// particulier : « Osez le Féminisme », « Fondation du patrimoine », « France Alzheimer » la
// franchissent ; « Elisa Rojas », « Tonton Alberto », « La meuf là » — des comptes personnels dont
// la biographie cite le domaine — ne la franchissent pas. Mesuré le 25/09/2026 : sans cette règle,
// la recherche « gastronomie » proposait trois particuliers sur quatre résultats.
export function parleDu(domaine, compte) {
  // 3 lettres suffisent : « Dax », « Pau », « Agen » sont des communes, et les écarter privait
  // leurs articles du compte de leur propre ville. La sécurité vient de la frontière de mot.
  const mots = fold(domaine).split(/[^a-z0-9]+/).filter((m) => m.length >= 3);
  if (!mots.length) return false;
  const nom = fold(compte.nom ?? '');
  return mots.every((m) => {
    // racine : « féminisme » reconnaît « féministe », « apiculture » reconnaît « apiculteur »
    const racine = m.slice(0, Math.max(4, m.length - 3));
    // ...mais en **début de mot** seulement. Sans cette frontière, « trail » se reconnaissait dans
    // « PaperTrail Media », une rédaction d'investigation allemande, retenue comme référence du
    // trail le 25/09/2026.
    return new RegExp(`(^|[^\\p{L}\\p{N}])${racine}`, 'u').test(nom);
  });
}

// Un résultat de recherche Bluesky doit se présenter comme une organisation. Les noms d'affichage
// y sont libres : « JV - Culture Jeu Vidéo » (un magazine de jeu vidéo) passait sous « culture »,
// « IRIS » (un laboratoire) sous « santé ». Une institution se nomme comme telle, ou le dit
// d'entrée dans sa biographie.
const ORGANISATION = /\b(association|asso|federation|fondation|musee|museum|centre|institut|ministere|office|agence|conservatoire|observatoire|reseau|ligue|union|collectif|maison|comite|societe|syndicat|parc|ville|mairie|commune|region|departement|archives|bibliotheque|mediatheque|academie|chambre|conseil|confederation|cooperative|festival|france|francaise?|nationale?|officiel(le)?)\b/;
const ORGANISATION_BIO = /\b(association|fondation|federation|compte officiel|loi 1901|utilite publique|ong)\b/;
export const seDitOrganisation = (compte) =>
  ORGANISATION.test(fold(compte.nom ?? '')) || ORGANISATION_BIO.test(fold(compte.description ?? ''));

// Une référence **nationale** du domaine se nomme par lui : « Santé publique France », « France
// Rugby », « Office français de la biodiversité », « Fédération française de la randonnée pédestre ».
// Un nom qui ajoute ses propres mots désigne une organisation plus étroite, utile à son public mais
// hors sujet ailleurs : le 25/09/2026, « Espace Santé Trans » et « Winslow Santé Publique » (Covid
// long) passaient sous la fermeture d'une maternité, au seul motif du mot « santé ».
// Le nom doit donc s'écrire presque entièrement avec le domaine, des mots d'institution et des
// sigles ; aux deux tiers seulement s'il se dit national (France, fédération, fondation…).
const INSTITUTIONNELS = 'france francais francaise francaises national nationale nationaux federation fondation association asso union ligue societe institut centre observatoire collectif office agence ministere publique public officiel officielle reseau maison comite conseil academie confederation chambre syndicat musee archives compte les des pour sur aux une par avec dans du de la le et en';
const NATIONAL = /\b(france|francaise?s?|nationale?s?|federation|fondation|union|confederation|office|agence|ministere|observatoire|institut|conservatoire|academie|ligue)\b/;
export function referenceDuDomaine(domaine, compte) {
  const nom = String(compte.nom ?? '');
  // un sigle (« CNL », « FRB ») n'ajoute pas de sens au nom : il l'abrège
  const sigles = (nom.match(/\b[A-Z]{2,6}\b/g) ?? []).join(' ');
  const part = couverture(nom, `${domaine} ${INSTITUTIONNELS} ${sigles}`);
  return part >= 0.85 || (part >= 0.6 && NATIONAL.test(fold(nom)));
}

// Un domaine national étranger dans le pseudo suffit à trancher : @papertrailmedia.de est une
// rédaction allemande. Les .com et .fr ne disent rien, les autres disent beaucoup.
const TLD_ETRANGER = /\.(de|es|it|uk|nl|be|ch|ca|no|se|dk|pt|pl|at|ie|br|us|jp)$/i;

// Le jugement, en une seule fonction. Les portes sont franchies dans l'ordre, et chaque refus dit
// pourquoi. Ce que la preuve établit déjà n'est pas redemandé : un compte que l'entité déclare
// elle-même est le sien, quelle que soit sa taille ou la langue de sa biographie.
//
// `exigerNom` : la porte de l'institution. Elle vaut pour un domaine, où le candidat vient d'une
// recherche et peut parler d'autre chose. Elle ne vaut pas pour une commune, où le pseudo est
// **construit** depuis le nom de la ville — @visitbordeaux vient de « Bordeaux », l'exiger dans
// son nom d'affichage le rejetterait pour un détail de graphie. Le garde-fou reste la biographie :
// c'est elle qui démasque « VILLE LA ROCHELLE », domaine événementiel brésilien.
export function retenir(compte, {
  domaine, reseau, exigerNom = true, preuve = PREUVE.TROUVEE,
  seuil = SEUILS[reseau] ?? 1000, local = false, organisation = false, reference = false,
} = {}) {
  const refus = (motif) => ({ garde: false, motif });
  // jamais, quelle que soit la preuve
  if (ADULTE.test(sansAccents(`${compte.nom ?? ''} ${compte.description ?? ''}`))) return refus('contenu pour adultes');
  if (TLD_ETRANGER.test(String(compte.handle ?? ''))) return refus('pseudo sur un domaine national étranger');
  // l'identité est établie : rien d'autre à vérifier
  if (preuve >= PREUVE.DECLAREE) return { garde: true, motif: null };
  const abonnes = compte.abonnes ?? null;
  if (abonnes === null) return refus('audience inconnue');
  if (abonnes < seuil) return refus(`${abonnes} abonnés, sous le seuil de ${seuil}`);
  if (exigerNom && !parleDu(domaine, compte)) return refus(`« ${compte.nom} » n’est pas une institution du domaine`);
  if (organisation && !seDitOrganisation(compte)) return refus(`« ${compte.nom} » ne se présente pas comme une organisation`);
  if (reference && !referenceDuDomaine(domaine, compte)) return refus(`« ${compte.nom} » n’est pas une référence nationale du domaine`);
  // la langue se juge sur la biographie seule : une enseigne peut se dire « France » et écrire
  // en espagnol. Une biographie vide ne prouve rien, donc elle ne passe pas — sauf ancrage local.
  if (!semblFrancais(compte.description, { local })) return refus('biographie non française ou absente');
  return { garde: true, motif: null };
}

// ── Formes de pseudos ──
// Des candidats, jamais des réponses : chacun est décrit par l'API puis jugé. Les formes sont des
// données, rangées de la plus courante à la plus rare ; en ajouter une ne touche à aucune règle.
// {v} : la commune, {d} : le domaine, sans accents ni séparateurs.
export const FORMES = {
  // @francerugby, @santepubliquefrance, @ffvoile : les usages des organisations nationales
  domaine: ['{d}', 'france{d}', '{d}france', '{d}_france', '{d}.fr', '{d}_fr', '{d}officiel', 'les{d}', 'le{d}', 'ff{d}', 'ff_{d}', 'federation{d}'],
  // Mesuré le 25/09/2026 : @villedebergerac et @villedecognac manquaient faute de la forme « villede ».
  // Ce n'est plus que le dernier recours : la fiche Wikidata de la commune et son site officiel
  // déclarent aussi @ville_pau, @ville2biarritz, @montdemarsan_ville — qu'aucune forme ne devine.
  mairie: ['ville{v}', 'villede{v}', 'villed{v}', '{v}maville', 'mairie{v}', 'mairiede{v}', '{v}ville', 'ville_{v}', 'ville_de_{v}', '{v}_ville', '{v}_officiel'],
  // @destinationcognac est l'office de tourisme de Cognac : « destination » est un usage courant
  tourisme: ['visit{v}', '{v}tourisme', 'tourisme{v}', '{v}_tourisme', 'ot{v}', 'destination{v}', '{v}tourism', 'officedetourisme{v}'],
  // le domaine dans la commune : @hossegorsurfclub (9 716 abonnés) pour un article de surf à Hossegor
  locale: ['{v}{d}club', '{v}{d}', '{d}{v}', '{v}_{d}', '{d}_{v}', '{d}club{v}'],
};

const compact = (s) => fold(s).replace(/[^a-z0-9]+/g, '');
const VOYELLE = /^[aeiouy]/;
const instancier = (modeles, { v = '', d = '' }) => [...new Set(modeles
  // « villede » devant une consonne, « villed » devant une voyelle : ville d'Arcachon, de Cognac
  .filter((m) => !(m.includes('villede{v}') || m.includes('mairiede{v}')) || !VOYELLE.test(v))
  .filter((m) => !m.includes('villed{v}') || VOYELLE.test(v))
  .map((m) => m.replaceAll('{v}', v).replaceAll('{d}', d)))]
  .filter((h) => h.length <= 30); // limite d'Instagram

// Pseudos plausibles d'une organisation française du domaine.
export const formesInstagram = (domaine) => {
  const d = compact(domaine);
  return d.length < 4 ? [] : instancier(FORMES.domaine, { d });
};

// Deux natures de compte, et elles ne se taguent pas dans les mêmes articles. La ville parle de
// tout ce qui arrive sur son territoire ; l'office de tourisme parle aux visiteurs. Taguer
// @daxtourisme sous le financement d'un village Alzheimer, ou @visitbordeaux sous une recherche
// sur les levures œnologiques, c'est s'adresser à la mauvaise audience et le montrer.
export const formesCommune = (ville, nature = 'mairie') => {
  const v = compact(ville);
  return v.length < 3 ? [] : instancier(FORMES[nature === 'tourisme' ? 'tourisme' : 'mairie'], { v });
};

// Le domaine dans la commune : la plus forte pertinence qui soit, une audience locale et
// passionnée par le sujet même de l'article.
export const formesLocales = (ville, domaine) => {
  const v = compact(ville);
  const d = compact(domaine);
  return v.length < 3 || d.length < 4 ? [] : instancier(FORMES.locale, { v, d });
};

// L'article s'adresse-t-il à des visiteurs ? C'est la question qui autorise l'office de tourisme.
// Les catégories du flux tranchent mieux que le texte : elles sont posées par la rédaction.
// Frontières de mot obligatoires : sans elles, « Agriculture » contenait « culture » et un article
// sur des frelons asiatiques devenait un sujet touristique.
const CATEGORIES_TOURISME = /\b(visites?|loisirs|agenda|tourisme|restaurants?|sortir|patrimoine|culture|balades?|randonn\w*)\b/i;
const MOTS_TOURISME = /\b(visite[rs]?|visiteurs?|touristes?|séjour|escale|festival|exposition|spectacle|concert|billetterie|réserver|ouvre ses portes|week-?end|vacances|marché de noël|à découvrir|dormir|nuitée|dégustation|parcours|itinéraire)\b/i;

export const sujetTouristique = (texte, categories = []) =>
  categories.some((c) => CATEGORIES_TOURISME.test(String(c))) || MOTS_TOURISME.test(String(texte ?? ''));

// Découverte sur Instagram : pseudos fabriqués, décrits par l'API, jugés.
// `decrire` renvoie la description d'un pseudo, ou null s'il n'existe pas ou reste muet.
export async function surInstagram(domaine, { decrire, log = () => {}, formes = formesInstagram, ...jugement } = {}) {
  const descriptions = await enParallele(formes(domaine), 4, (h) => decrire(h));
  const trouves = [];
  for (const b of descriptions) {
    if (!b) continue;
    const compte = { handle: b.username ?? b.handle, nom: b.name ?? b.nom ?? '', description: b.biography ?? b.description ?? '', abonnes: b.followers_count ?? b.abonnes ?? null, site: b.website ?? b.site ?? null };
    const { garde, motif } = retenir(compte, { domaine, reseau: 'instagram', preuve: PREUVE.CONSTRUITE, ...jugement });
    if (garde) trouves.push(compte);
    else log(`   @${compte.handle} écarté : ${motif}`);
  }
  // le plus suivi d'abord : à pertinence égale, c'est lui qui fait découvrir le média au plus grand nombre
  return trouves.filter((c, i, t) => t.findIndex((x) => x.handle === c.handle) === i).sort((a, b) => (b.abonnes ?? 0) - (a.abonnes ?? 0));
}

// Découverte sur Bluesky : vraie recherche d'acteurs, profils lus, jugés — et le candidat doit se
// présenter comme une organisation, les noms d'affichage y étant trop libres pour suffire.
export async function surBluesky(domaine, { chercher, lireProfil, log = () => {}, reference = false }) {
  const acteurs = (await chercher(domaine)) ?? [];
  const profils = await enParallele(acteurs, 4, (a) => lireProfil(a.handle).catch(() => null));
  const trouves = [];
  acteurs.forEach((a, i) => {
    const p = profils[i] ?? {};
    const compte = {
      handle: a.handle,
      nom: p.nom ?? a.nom ?? '',
      description: p.description ?? a.description ?? '',
      abonnes: p.abonnes ?? a.abonnes ?? null,
    };
    const { garde, motif } = retenir(compte, { domaine, reseau: 'bluesky', organisation: true, reference });
    if (garde) trouves.push(compte);
    else log(`   @${compte.handle} écarté : ${motif}`);
  });
  return trouves;
}
