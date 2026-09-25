// Wikidata : fiche officielle d'une entité — comptes déclarés, site officiel, identifiant de lieu Facebook.
// Source gratuite, sans clé, et surtout vérifiable : rien n'est deviné, tout vient de la fiche.
import { correspond, contient, motsCles } from '../brain/annuaire.mjs';

const API = 'https://www.wikidata.org/w/api.php';
const UA = 'pa-social/0.1 (+https://passion-aquitaine.ouest-france.fr)';
const TIMEOUT = 8000;

// Bluesky (P12361) et Threads (P11892) : déclarés sur la fiche comme Instagram, donc aussi sûrs
const PROPS = { insta: 'P2003', x: 'P2002', facebook: 'P4003', bluesky: 'P12361', threads: 'P11892', site: 'P856', lieu: 'P1997' };

// une même entité revient d'un réseau à l'autre pour un même article
const cache = new Map();

async function json(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
  return res.json();
}

const valeur = (claims, prop) => {
  const v = claims?.[prop]?.[0]?.mainsnak?.datavalue?.value;
  return typeof v === 'string' ? v : null;
};

// « Ville de Bordeaux » tombe sur un cargo, « Bordeaux » sur la ville et ses comptes :
// on interroge donc aussi le nom débarrassé de son préfixe administratif.
const PREFIXE = /^(?:ville|mairie|commune|conseil départemental|conseil departemental|département|departement|office de tourisme)\s+(?:de\s+|des\s+|du\s+|d[’']\s*)?/i;
const PREFIXE_DEPT = /^(?:le\s+)?(?:conseil départemental|conseil departemental|département|departement)\s/i;
const ARTICLE = /^(?:la|le|les)\s+/i;

// « Ville de La Rochelle » → « La Rochelle » : l'article est conservé, sans quoi il resterait « Rochelle ».
// Pour un département seulement, on tente aussi sans article (« la Gironde » est un journal du XIXᵉ
// numérisé par Gallica ; le département, lui, s'appelle « Gironde »).
export const variantes = (nom) => {
  const brut = String(nom).trim();
  const sansPrefixe = brut.replace(PREFIXE, '').trim();
  const sansArticle = PREFIXE_DEPT.test(brut) ? sansPrefixe.replace(ARTICLE, '').trim() : '';
  return [...new Set([brut, sansPrefixe, sansArticle])].filter((v) => v.length > 2);
};

// Un simple site ne suffit pas à arrêter la recherche : la fiche du journal « La Gironde » n'a qu'un
// lien Gallica, et s'y arrêter nous privait du département, qui porte les vrais comptes.
const renseignee = (f) => Boolean(f && (f.insta || f.x || f.bluesky || f.threads));

// Cherche l'entité par son nom et renvoie ses comptes déclarés ; null si aucune fiche.
// `partiel` : le libellé peut porter d'autres mots que le nom cherché — une commune composée
// (« Hossegor » pour Soorts-Hossegor). Réservé aux cas où le contexte départage à coup sûr.
export async function fiche(nom, contexte = '', { partiel = false } = {}) {
  const propre = String(nom ?? '').trim().toLowerCase();
  if (!propre) return null;
  // le contexte change le résultat : il fait donc partie de la clé du cache
  const cle = `${propre}|${String(contexte ?? '').length}|${partiel}`;
  // la promesse est gardée, pas seulement le résultat : deux demandes simultanées ne font qu'une recherche
  if (!cache.has(cle)) {
    cache.set(cle, (async () => {
      let resultat = null;
      for (const variante of variantes(String(nom).trim())) {
        // ficheBrute ne retient que des fiches qui portent le nom : « Département de la Gironde »
        // tombait sur Gallica, et nous aurions tagué la BnF à la place du Département
        const trouvee = await ficheBrute(variante, contexte, partiel);
        if (!trouvee) continue;
        // on garde la première fiche qui porte vraiment des comptes
        if (renseignee(trouvee)) { resultat = trouvee; break; }
        resultat ??= trouvee;
      }
      return resultat;
    })());
  }
  return cache.get(cle);
}

// Mots du contexte qui servent à départager des homonymes : assez longs pour être distinctifs, et
// au singulier — « parc d'attractions » doit reconnaître « une nouvelle attraction ».
const motsDistinctifs = (texte) => new Set(
  String(texte ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
    .split(/[^a-z0-9]+/).filter((m) => m.length >= 5)
    .map((m) => (m.length >= 6 ? m.replace(/[sx]$/, '') : m)),
);

// La fiche porte-t-elle le nom cherché ? Tous ses mots, sans en ajouter (« Université de Bordeaux »
// n'est pas « Bordeaux ») ; ou, quand le libellé est plus court que le nom, le reste écrit dans la
// description : « Francofolies », « festival de musique à La Rochelle », c'est bien « Francofolies
// de La Rochelle ».
function porteLeNom(nom, r, partiel) {
  if (correspond(nom, { nom: r.label }) || (partiel && contient(nom, { nom: r.label }))) return true;
  const libelle = motsCles(r.label ?? '');
  const voulus = motsCles(nom);
  return libelle.length > 0 && libelle.every((m) => voulus.includes(m)) && contient(nom, { nom: `${r.label} ${r.description ?? ''}` });
}

// Le contexte de l'article départage les homonymes d'un nom d'un seul mot, et c'est indispensable.
//
// 25/09/2026, mesuré : « Belem » renvoie d'abord la capitale de l'État de Pará au Brésil, et le
// trois-mâts français arrive deuxième ; « Hermione » renvoie un prénom, un genre de plantes,
// Hermione Granger, un astéroïde — et le navire de guerre en huitième position. Chercher sur trois
// résultats et prendre le premier renseigné donnait donc la mairie de Belém. Avec le contexte, la
// bonne fiche se reconnaît : sa description partage un mot avec l'article (« trois-mâts barque
// français »), et son site officiel suffit — fondationbelem.com livre @troismatsbelem.
//
// Un nom complet (« FC Girondins de Bordeaux », « Zoo de La Palmyre ») n'a guère d'homonyme, et sa
// fiche n'a pas à partager un mot avec l'article, qui parle d'une relégation ou d'un bébé girafe
// quand elle dit « club de football » ou « parc zoologique ». Pour lui, la fiche qui porte des
// comptes l'emporte : sans cette priorité, « Girondins de Bordeaux C », l'équipe réserve, gagnait
// parce que sa description contenait « National ».
async function ficheBrute(nom, contexte = '', partiel = false) {
  const mots = motsDistinctifs(contexte);
  const complet = motsCles(nom).length >= 2;
  const note = (c) => (mots.size && [...motsDistinctifs(c.description)].some((m) => mots.has(m)) ? 2 : 0)
    + (renseignee(c) ? (complet ? 3 : 1) : 0)
    + (c.site ? 0.5 : 0);
  const candidats = [];
  try {
    const recherche = await json(`${API}?action=wbsearchentities&search=${encodeURIComponent(nom)}&language=fr&uselang=fr&format=json&limit=8`);
    for (const top of (recherche.search ?? []).filter((r) => porteLeNom(nom, r, partiel))) {
      const detail = await json(`${API}?action=wbgetentities&ids=${top.id}&props=claims&format=json`);
      const claims = detail.entities?.[top.id]?.claims ?? {};
      const candidat = {
        id: top.id,
        label: top.label ?? nom,
        description: top.description ?? '',
        ...Object.fromEntries(Object.entries(PROPS).map(([k, p]) => [k, valeur(claims, p)])),
      };
      candidats.push(candidat);
      // une fiche qui porte les comptes ET colle au contexte ne sera pas battue : on s'arrête là
      if (note(candidat) >= 3 + (complet ? 2 : 0)) return candidat;
    }
  } catch (e) {
    // réseau indisponible : on préfère aucune mention à une mention hasardeuse
    console.error(`   Wikidata « ${nom} » : ${e.message}`);
  }
  if (!candidats.length) return null;
  const classe = [...candidats].sort((a, b) => note(b) - note(a));
  // un nom d'un seul mot sans appui dans le contexte : rien ne départage, on s'abstient
  if (mots.size && !complet && note(classe[0]) < 2) return null;
  return classe[0];
}
