import { readFileSync } from 'node:fs';
import { fromRoot } from '../core/config.mjs';
import { fiche } from '../sources/wikidata.mjs';
import { handlesFromSite } from '../sources/site.mjs';
import { chercheActeurs, profil } from '../sources/bsky-public.mjs';
import { surThreads } from '../sources/threads.mjs';
import { correspond, suspect, choisir, fold, motsCles, nomExploitable } from './annuaire.mjs';

// Dernier recours pour les collectivités de notre zone : certains sites chargent leurs réseaux
// en JavaScript, donc ni la fiche ni le balayage ne les voient. Table courte et vérifiée.
const { institutions = {} } = JSON.parse(readFileSync(fromRoot('config/comptes.json'), 'utf8'));
const PREFIXE = /^(?:le\s+)?(?:département|departement|conseil départemental|conseil departemental)\s+(?:de\s+la\s+|de\s+l[’']|de\s+|des\s+|du\s+|d[’'])?/i;

const depuisTable = (nom) => {
  const cle = fold(String(nom).replace(PREFIXE, '').trim());
  const trouvee = Object.keys(institutions).find((k) => fold(k) === cle);
  return trouvee ? institutions[trouvee] : null;
};

// De « Musée d'Aquitaine » aux comptes réels, réseau par réseau.
// Chaîne : fiche officielle → site de l'entité → vérification. Jamais de pseudo deviné.

// Pseudos dérivés du nom exact, dans un ordre fixe : « Morimoto Bordeaux » donne morimotobordeaux,
// morimoto_bordeaux, morimoto.bordeaux. Chacun est ensuite soumis à Meta, qui confirme ou non son
// existence : un commerce absent de Wikidata devient ainsi trouvable, sans jamais rien inventer.
export const variantesHandle = (nom) => {
  const m = motsCles(nom);
  return m.length < 2 ? [] : [m.join(''), m.join('_'), m.join('.')];
};

// Meta refuse un pseudo inexistant ou privé : c'est notre preuve d'existence.
async function existeSurInstagram(handle, image) {
  const token = process.env.IG_TOKEN;
  const userId = process.env.IG_USER_ID;
  if (!token || !userId || !image) return false;
  try {
    const res = await fetch(`https://graph.facebook.com/${process.env.GRAPH_VERSION || 'v23.0'}/${userId}/media`, {
      method: 'POST',
      body: new URLSearchParams({
        image_url: image,
        is_carousel_item: 'true',
        user_tags: JSON.stringify([{ username: handle, x: 0.5, y: 0.9 }]),
        access_token: token,
      }),
      // sans délai, un appel qui ne répond pas fige toute l'exécution
      signal: AbortSignal.timeout(15000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Instagram et X : la fiche donne parfois le compte, le site officiel presque toujours
async function comptesMeta(entite, image) {
  const f = await fiche(entite.nom);
  const site = f?.site ? await handlesFromSite(f.site) : { insta: [], x: [], facebook: [] };
  const table = depuisTable(entite.nom) ?? {};

  let instagram = f?.insta ?? site.insta[0] ?? table.instagram ?? null;
  if (!instagram) {
    for (const candidat of variantesHandle(entite.nom)) {
      if (await existeSurInstagram(candidat, image)) { instagram = candidat; break; }
    }
  }
  return {
    instagram,
    x: f?.x ?? site.x[0] ?? table.x ?? null,
    // Facebook : fiche officielle seulement. Un site cite souvent d'autres pages que la sienne
    // (bordeaux.fr renvoyait « bordeauxmaville », un site d'actualité) et l'erreur serait invisible.
    facebook: f?.facebook ?? null,
  };
}

// Bluesky : on cherche, on ne garde que le nom qui correspond mot pour mot, puis on juge le profil
async function compteBluesky(entite) {
  const candidats = (await chercheActeurs(entite.nom)).filter((c) => correspond(entite.nom, c));
  for (const c of candidats) {
    const p = (await profil(c.handle)) ?? c;
    if (!suspect({ ...c, ...p })) return c.handle;
  }
  return null;
}

// Un compte par entité et par réseau, deux entités au maximum
export async function resoudreComptes(entites = [], { max = 2, image = null, log = () => {} } = {}) {
  const plan = { instagram: [], x: [], bluesky: [], threads: [], facebook: [] };
  // Un nom d'un seul mot ne se vérifie pas : on préfère aucune mention à un homonyme
  const exploitables = entites.filter((e) => {
    if (nomExploitable(e.nom)) return true;
    log(`   Entité « ${e.nom} » ignorée : nom trop court pour être vérifié`);
    return false;
  });
  const retenues = choisir(exploitables.map((e) => ({ ...e, entite: e.nom, handle: e.nom })), { max });

  for (const entite of retenues) {
    const [meta, bluesky] = await Promise.all([comptesMeta(entite, image), compteBluesky(entite)]);
    const sur = meta.instagram ? await surThreads(meta.instagram) : false;

    if (meta.instagram) plan.instagram.push({ nom: entite.nom, handle: meta.instagram, role: entite.role });
    if (meta.x) plan.x.push({ nom: entite.nom, handle: meta.x, role: entite.role });
    if (meta.facebook) plan.facebook.push({ nom: entite.nom, handle: meta.facebook, role: entite.role });
    if (bluesky) plan.bluesky.push({ nom: entite.nom, handle: bluesky, role: entite.role });
    if (sur) plan.threads.push({ nom: entite.nom, handle: meta.instagram, role: entite.role });

    const trouve = [meta.instagram && 'Instagram', bluesky && 'Bluesky', sur && 'Threads', meta.x && 'X'].filter(Boolean);
    log(`   Comptes « ${entite.nom} » (${entite.role}) : ${trouve.join(', ') || 'aucun, pas de mention'}`);
  }
  return plan;
}
