import { fiche } from '../sources/wikidata.mjs';
import { handlesFromSite } from '../sources/site.mjs';
import { chercheActeurs, profil } from '../sources/bsky-public.mjs';
import { surThreads } from '../sources/threads.mjs';
import { correspond, suspect, choisir } from './annuaire.mjs';

// De « Musée d'Aquitaine » aux comptes réels, réseau par réseau.
// Chaîne : fiche officielle → site de l'entité → vérification. Jamais de pseudo deviné.

// Instagram et X : la fiche donne parfois le compte, le site officiel presque toujours
async function comptesMeta(entite) {
  const f = await fiche(entite.nom);
  const site = f?.site ? await handlesFromSite(f.site) : { insta: [], x: [], facebook: [] };
  return {
    instagram: f?.insta ?? site.insta[0] ?? null,
    x: f?.x ?? site.x[0] ?? null,
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
export async function resoudreComptes(entites = [], { max = 2, log = () => {} } = {}) {
  const plan = { instagram: [], x: [], bluesky: [], threads: [], facebook: [] };
  const retenues = choisir(entites.map((e) => ({ ...e, entite: e.nom, handle: e.nom })), { max });

  for (const entite of retenues) {
    const [meta, bluesky] = await Promise.all([comptesMeta(entite), compteBluesky(entite)]);
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
