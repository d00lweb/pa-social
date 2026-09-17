// Wikidata : fiche officielle d'une entité — comptes déclarés, site officiel, identifiant de lieu Facebook.
// Source gratuite, sans clé, et surtout vérifiable : rien n'est deviné, tout vient de la fiche.
const API = 'https://www.wikidata.org/w/api.php';
const UA = 'pa-social/0.1 (+https://passion-aquitaine.ouest-france.fr)';
const TIMEOUT = 8000;

const PROPS = { insta: 'P2003', x: 'P2002', facebook: 'P4003', site: 'P856', lieu: 'P1997' };

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
const ARTICLE = /^(?:la|le|les|l[’'])\s*/i;

// « Ville de La Rochelle » → « La Rochelle » (l'article reste : « Rochelle » seul désigne autre chose)
export const variantes = (nom) => {
  const sansPrefixe = String(nom).replace(PREFIXE, '').trim();
  const sansArticle = sansPrefixe.replace(ARTICLE, '').trim();
  return [...new Set([String(nom).trim(), sansPrefixe, sansArticle])].filter((v) => v.length > 2);
};

const renseignee = (f) => Boolean(f && (f.insta || f.x || f.site));

// Cherche l'entité par son nom et renvoie ses comptes déclarés ; null si aucune fiche
export async function fiche(nom) {
  const cle = String(nom ?? '').trim().toLowerCase();
  if (!cle) return null;
  if (cache.has(cle)) return cache.get(cle);

  let resultat = null;
  for (const variante of variantes(String(nom).trim())) {
    const trouvee = await ficheBrute(variante);
    // on garde la première fiche qui porte vraiment des comptes
    if (renseignee(trouvee)) { resultat = trouvee; break; }
    resultat ??= trouvee;
  }
  cache.set(cle, resultat);
  return resultat;
}

async function ficheBrute(nom) {
  let resultat = null;
  try {
    const recherche = await json(`${API}?action=wbsearchentities&search=${encodeURIComponent(nom)}&language=fr&uselang=fr&format=json&limit=1`);
    const top = recherche.search?.[0];
    if (top) {
      const detail = await json(`${API}?action=wbgetentities&ids=${top.id}&props=claims&format=json`);
      const claims = detail.entities?.[top.id]?.claims ?? {};
      resultat = {
        id: top.id,
        label: top.label ?? nom,
        description: top.description ?? '',
        ...Object.fromEntries(Object.entries(PROPS).map(([k, p]) => [k, valeur(claims, p)])),
      };
    }
  } catch (e) {
    // réseau indisponible : on préfère aucune mention à une mention hasardeuse
    console.error(`   Wikidata « ${nom} » : ${e.message}`);
  }
  return resultat;
}
