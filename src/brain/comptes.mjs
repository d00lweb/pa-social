import { readFileSync } from 'node:fs';
import { fromRoot } from '../core/config.mjs';
import { fiche } from '../sources/wikidata.mjs';
import { handlesFromSite } from '../sources/site.mjs';
import { chercheActeurs, profil } from '../sources/bsky-public.mjs';
import { surThreads } from '../sources/threads.mjs';
import { correspond, suspect, choisir, fold, motsCles, nomExploitable } from './annuaire.mjs';

// Dernier recours pour les collectivités de notre zone : certains sites chargent leurs réseaux
// en JavaScript, donc ni la fiche ni le balayage ne les voient. Table courte et vérifiée.
const { institutions = {}, thematiques = {} } = JSON.parse(readFileSync(fromRoot('config/comptes.json'), 'utf8'));
const PREFIXE = /^(?:le\s+)?(?:département|departement|conseil départemental|conseil departemental)\s+(?:de\s+la\s+|de\s+l[’']|de\s+|des\s+|du\s+|d[’'])?/i;

const depuisTable = (nom) => {
  const cle = fold(String(nom).replace(PREFIXE, '').trim());
  const trouvee = Object.keys(institutions).find((k) => fold(k) === cle);
  return trouvee ? institutions[trouvee] : null;
};

// De « Musée d'Aquitaine » aux comptes réels, réseau par réseau.
// Chaîne : fiche officielle → site de l'entité → vérification. Jamais de pseudo deviné.

// Pseudos dérivés du nom exact. Chacun est ensuite soumis à Meta, qui confirme ou non son
// existence : un commerce absent de Wikidata devient ainsi trouvable, sans jamais rien inventer.
//
// 25/09/2026 : « Ultra Trail de Pons » n'a produit que ultratrailpons, ultra_trail_pons et
// ultra.trail.pons. Le compte réel est @ultratraildepons_officiel — il garde le « de » et ajoute
// « _officiel ». Trois formes contre des dizaines d'usages réels : le compte existait, était
// taguable, et n'a jamais été proposé.
//
// Élargir ne fait courir aucun risque d'invention, puisque Meta reste l'arbitre : un pseudo
// inexistant est refusé. Le seul risque serait l'homonyme, et il est écarté autrement — chaque
// candidat est bâti sur **tous** les mots distinctifs du nom, et un nom d'un seul mot est refusé
// en amont. On ne cherche jamais « pons », seulement « ultratraildepons ».
const SUFFIXES = ['', '_officiel', 'officiel', '.officiel', '_off'];

export const variantesHandle = (nom) => {
  const forts = motsCles(nom);                                             // sans les petits mots
  if (forts.length < 2) return [];
  const tous = fold(nom).split(/[^a-z0-9]+/).filter(Boolean);              // « de », « du », « la » compris
  const bases = [];
  for (const mots of tous.length > forts.length ? [tous, forts] : [forts]) {
    for (const lien of ['', '_', '.']) bases.push(mots.join(lien));
  }
  // Les formes les plus courantes d'abord : le premier pseudo confirmé arrête la recherche.
  const sortie = [];
  for (const suffixe of SUFFIXES) for (const base of bases) sortie.push(base + suffixe);
  // Chaque candidat coûte un appel à Meta : on s'arrête aux douze formes les plus courantes,
  // ordonnées du plus probable au moins probable. Au-delà, on paierait cher un gain marginal.
  return [...new Set(sortie)].filter((h) => h.length <= 30).slice(0, 12); // 30 = limite d'Instagram
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

// Nombre d'abonnés d'un compte, quand Instagram accepte de le dire. `business_discovery` ne
// répond que pour les comptes professionnels ou créateurs : un compte personnel reste muet, et
// c'est justement le cas des deux « Ultra Trail de Pons ». D'où le repli qui suit.
export async function abonnesDe(handle) {
  const token = process.env.IG_TOKEN;
  const userId = process.env.IG_USER_ID;
  if (!token || !userId) return null;
  try {
    const champs = `business_discovery.username(${handle}){followers_count}`;
    const res = await fetch(`https://graph.facebook.com/${process.env.GRAPH_VERSION || 'v23.0'}/${userId}?fields=${encodeURIComponent(champs)}&access_token=${token}`, { signal: AbortSignal.timeout(15000) });
    const json = await res.json().catch(() => ({}));
    const n = json?.business_discovery?.followers_count;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// Audience en dessous de laquelle un compte n'apporte rien : un squatteur, un compte abandonné,
// ou un homonyme minuscule. Ne s'applique qu'aux comptes dont Instagram publie les abonnés —
// un compte personnel reste muet et garde sa chance.
export const AUDIENCE_MINIMALE = 100;
// Deux comptes au plus pour une même entité : la troisième place revient à un compte de référence,
// dont l'audience se compte en dizaines de milliers.
const HOMONYMES_MAX = 2;

export async function garderLesMeilleurs(handles, nom, log = () => {}, mesurer = abonnesDe) {
  const mesures = await Promise.all(handles.map(async (h) => ({ handle: h, abonnes: await mesurer(h) })));
  const utiles = mesures.filter((m) => m.abonnes === null || m.abonnes >= AUDIENCE_MINIMALE);
  const ecartes = mesures.filter((m) => !utiles.includes(m));
  // les plus suivis d'abord ; les muets ensuite, dans l'ordre des candidats
  const classe = [...utiles].sort((a, b) => (b.abonnes ?? -1) - (a.abonnes ?? -1));
  const preferes = classe.some((m) => m.abonnes !== null) ? classe : rangerLesOfficiels(utiles);
  const retenus = preferes.slice(0, HOMONYMES_MAX).map((m) => m.handle);
  if (!retenus.length) return [handles[0]];
  log(`   « ${nom} » : ${handles.length} pseudos existent, retenus ${retenus.map((h) => `@${h}`).join(', ')}`
    + `${ecartes.length ? ` — écartés ${ecartes.map((m) => `@${m.handle} (${m.abonnes} abonnés)`).join(', ')}` : ''}`);
  return retenus;
}

// Aucun compte ne publie ses abonnés : celui qui se déclare officiel passe devant.
const rangerLesOfficiels = (mesures) => [...mesures].sort((a, b) => Number(/officiel|_off$/.test(b.handle)) - Number(/officiel|_off$/.test(a.handle)));

// Instagram et X : la fiche donne parfois le compte, le site officiel presque toujours
async function comptesMeta(entite, image, log = () => {}, contexte = '') {
  const f = await fiche(entite.nom, contexte);
  const site = f?.site ? await handlesFromSite(f.site) : { insta: [], x: [], facebook: [] };
  const table = depuisTable(entite.nom) ?? {};

  // Table vérifiée d'abord : c'est la seule source qui prouve l'identité, pas seulement l'existence.
  // `lies` : comptes voisins du sujet, inscrits à la main — le Mondrian Bordeaux héberge le
  // restaurant Morimoto et le dit dans sa bio, le taguer touche une audience déjà proche.
  let autres = [...(table.lies ?? [])];
  let instagram = table.instagram ?? f?.insta ?? site.insta[0] ?? null;
  if (!instagram) {
    // Meta prouve qu'un pseudo existe, jamais qu'il désigne la bonne entité. Le 25/09/2026,
    // @ultratraildepons et @ultratraildepons_officiel ont tous deux été acceptés, et aucune API
    // ne sait dire lequel est le compte de l'épreuve : tous deux sont des comptes personnels,
    // invisibles à business_discovery. On relève donc tous les pseudos acceptés avant de trancher.
    const acceptes = [];
    for (const candidat of variantesHandle(entite.nom)) {
      if (await existeSurInstagram(candidat, image)) acceptes.push(candidat);
    }
    if (acceptes.length === 1) [instagram] = acceptes;
    else if (acceptes.length > 1) {
      // Plusieurs comptes pour la même entité : on en tague deux, pas davantage. Ils sont bâtis
      // sur les mots du nom, donc aucun n'est étranger au sujet, et chacun peut suivre à son tour.
      // Mais « Miroir d'eau » en a produit trois d'un coup, dont un à 43 abonnés : ils occupaient
      // les trois places et évinçaient les comptes de référence, qui pèsent cent fois plus. Une
      // place reste donc toujours libre, et un compte dont on sait l'audience négligeable sort.
      const retenus = await garderLesMeilleurs(acceptes, entite.nom, log);
      [instagram] = retenus;
      autres = [...autres, ...retenus.slice(1)];
    }
  }
  return {
    instagram,
    autres,
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

// Comptes de référence d'un thème : pas des comptes cités par l'article, mais des audiences déjà
// rassemblées autour du sujet. Les taguer fait découvrir le média à des gens qui s'y intéressent
// déjà — c'est le levier de croissance le plus direct dont on dispose.
//
// Trois garde-fous, parce qu'une mention hors sujet coûte plus qu'elle ne rapporte :
//  · la table est écrite à la main, chaque compte vérifié (nom, bio, abonnés) avant inscription ;
//  · le thème ne s'applique que si l'un de ses mots figure vraiment dans l'article, en mot entier ;
//  · ces comptes ne viennent qu'après ceux que l'article nomme, et seulement s'il reste de la place.
// Rotation : le même article publié deux fois ne doit pas toucher deux fois la même audience.
// Mentionner systématiquement les deux plus gros comptes d'un thème, c'est parler chaque fois aux
// mêmes abonnés — ceux qui devaient suivre l'ont déjà fait. On prend donc en priorité ceux qu'on
// n'a jamais mentionnés, puis les plus anciennement mentionnés ; à égalité, l'ordre du vivier
// tranche (les tableaux sont rangés du plus large au plus étroit).
export function rotation(candidats, recents = [], combien = 3) {
  const vus = recents.map(fold);
  return candidats
    .map((c, ordre) => ({ c, ordre, vu: vus.lastIndexOf(fold(c.handle)) }))
    .sort((a, b) => a.vu - b.vu || a.ordre - b.ordre)
    .slice(0, Math.max(0, combien))
    .map((x) => x.c);
}

export function comptesThematiques(texte, reseau = 'instagram', table = thematiques) {
  const t = fold(texte ?? '');
  const mot = (m) => new RegExp(`(^|[^\\p{L}])${fold(m).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'u').test(t);
  const sortie = [];
  for (const [nom, theme] of Object.entries(table)) {
    if (!(theme.motsCles ?? []).some(mot)) continue;
    for (const handle of theme[reseau] ?? []) sortie.push({ nom, handle, role: 'theme', thematique: true });
  }
  return sortie;
}

// Annuaire des comptes de référence, constitué par la découverte et conservé d'un passage à
// l'autre. Un domaine déjà exploré n'est pas cherché deux fois : la recherche coûte des appels,
// et les organisations de référence d'un domaine ne changent pas d'une semaine sur l'autre.
// C'est ainsi que la table se remplit toute seule, au fil des articles, sans rien écrire à la main.
export async function annuaire(domaines, { log = () => {}, jours = 30, maintenant = Date.now() } = {}) {
  const { loadJson, saveJson } = await import('../core/state.mjs');
  const connu = await loadJson('comptes-appris.json', {});
  const sortie = { instagram: [], bluesky: [], threads: [], x: [], facebook: [] };
  let neuf = false;

  for (const domaine of domaines.slice(0, 3)) {
    const cle = fold(domaine);
    const fiche = connu[cle];
    if (!fiche || maintenant - Date.parse(fiche.cherche ?? 0) > jours * 86400e3) {
      const trouve = await chercherDomaine(domaine, log);
      connu[cle] = { cherche: new Date(maintenant).toISOString(), ...trouve };
      neuf = true;
      const total = Object.values(trouve).flat().length;
      log(`   Domaine « ${domaine} » : ${total ? Object.entries(trouve).filter(([, v]) => v.length).map(([r, v]) => `${r} ${v.map((c) => `@${c.handle}`).join(' ')}`).join(' · ') : 'aucune organisation de référence trouvée'}`);
    }
    for (const [reseau, comptes] of Object.entries(connu[cle])) {
      if (reseau === 'cherche' || !sortie[reseau]) continue;
      for (const c of comptes) sortie[reseau].push({ nom: c.nom || domaine, handle: c.handle, role: 'theme', thematique: true });
    }
  }
  if (neuf) await saveJson('comptes-appris.json', connu);
  return sortie;
}

// Une recherche par domaine, sur les deux réseaux qui permettent de découvrir : Instagram par
// pseudos plausibles soumis à l'API, Bluesky par sa recherche d'acteurs. Le filtre est le même.
async function chercherDomaine(domaine, log) {
  const [{ surInstagram, surBluesky, retenir }, { chercheActeurs, profil }] = await Promise.all([
    import('./decouverte.mjs'),
    import('../sources/bsky-public.mjs'),
  ]);
  const decrire = async (handle) => {
    const token = process.env.IG_TOKEN;
    const userId = process.env.IG_USER_ID;
    if (!token || !userId) return null;
    try {
      const champs = `business_discovery.username(${handle}){username,name,biography,followers_count}`;
      const r = await fetch(`https://graph.facebook.com/${process.env.GRAPH_VERSION || 'v23.0'}/${userId}?fields=${encodeURIComponent(champs)}&access_token=${token}`, { signal: AbortSignal.timeout(15000) });
      return (await r.json().catch(() => ({})))?.business_discovery ?? null;
    } catch { return null; }
  };
  const lireProfil = async (handle) => {
    const p = await profil(handle).catch(() => null);
    return p ? { nom: p.nom ?? p.displayName, description: p.description, abonnes: p.abonnes ?? p.followersCount } : null;
  };
  const [devines, bluesky] = await Promise.all([
    surInstagram(domaine, { decrire, log: () => {} }).catch(() => []),
    surBluesky(domaine, { chercher: chercheActeurs, lireProfil, log: () => {} }).catch(() => []),
  ]);

  // Le pont entre les deux réseaux, et c'est lui qui rend la découverte utile sur Instagram.
  // Un pseudo fabriqué depuis le mot du domaine ne trouvera jamais l'Office français de la
  // biodiversité, qui se nomme @ofbiodiversite et compte 50 383 abonnés — ni la Ligue pour la
  // protection des oiseaux, qui est @lpo_officiel et non @lpofrance, comme je l'avais supposé.
  // Bluesky, lui, donne le **nom** de l'organisation ; Wikidata et son site officiel donnent
  // ensuite ses pseudos. Deux vérifications enchaînées, aucune devinette.
  const ponts = [];
  for (const org of bluesky) {
    if (!org.nom) continue;
    const meta = await comptesMeta({ nom: org.nom, role: 'theme' }, null, () => {}).catch(() => null);
    if (!meta?.instagram) continue;
    const b = await decrire(meta.instagram);
    if (!b) continue;
    const compte = { handle: b.username ?? meta.instagram, nom: b.name ?? org.nom, description: b.biography ?? '', abonnes: b.followers_count ?? null };
    const { garde } = retenir(compte, { domaine, reseau: 'instagram' });
    if (garde) ponts.push(compte);
  }

  const instagram = [...devines, ...ponts].filter((c, i, t) => t.findIndex((x) => fold(x.handle) === fold(c.handle)) === i);
  const garder = (liste) => liste.slice(0, 3).map((c) => ({ handle: c.handle, nom: c.nom, abonnes: c.abonnes }));
  // Threads reprend le pseudo Instagram : un compte de référence trouvé sur Instagram y est
  // mentionnable tel quel, à condition d'y exister vraiment. La vérification est gratuite.
  const retenusIg = garder(instagram);
  const threads = [];
  for (const c of retenusIg) if (await surThreads(c.handle).catch(() => false)) threads.push(c);
  return { instagram: retenusIg, bluesky: garder(bluesky), threads };
}

// Un compte par entité et par réseau, trois entités au maximum
// Trois mentions au plus : c'est le levier le plus efficace pour être découvert — un compte
// mentionné est notifié, et va voir. Au-delà, la publication ressemble à du démarchage.
export async function resoudreComptes(entites = [], { max = 3, image = null, texte = null, domaines = [], recents = [], log = () => {} } = {}) {
  const plan = { instagram: [], x: [], bluesky: [], threads: [], facebook: [] };
  // Un nom d'un seul mot ne se vérifie pas : on préfère aucune mention à un homonyme
  // Un nom d'un seul mot — « Belem », « Hermione » — ne permet aucune devinette : @lebelem est un
  // café bar, @belem_officiel une personne. Il reste pourtant exploitable par la seule voie sûre,
  // la fiche officielle départagée par le contexte de l'article : elle mène au site du Belem, qui
  // déclare @troismatsbelem. On ne l'écarte donc plus, on lui interdit les raccourcis —
  // variantesHandle ne produit rien pour un mot seul, et la recherche Bluesky lui est fermée.
  const exploitables = entites.map((e) => ({ ...e, seul: !nomExploitable(e.nom) }));
  const retenues = choisir(exploitables.map((e) => ({ ...e, entite: e.nom, handle: e.nom })), { max });

  for (const entite of retenues) {
    const [meta, bluesky] = await Promise.all([
      comptesMeta(entite, image, log, texte ?? ''),
      entite.seul ? null : compteBluesky(entite),
    ]);
    const sur = meta.instagram ? await surThreads(meta.instagram) : false;

    if (meta.instagram) plan.instagram.push({ nom: entite.nom, handle: meta.instagram, role: entite.role });
    // homonymes du même nom : tagués aussi, ils peuvent suivre à leur tour
    for (const h of meta.autres ?? []) plan.instagram.push({ nom: entite.nom, handle: h, role: entite.role });
    if (meta.x) plan.x.push({ nom: entite.nom, handle: meta.x, role: entite.role });
    if (meta.facebook) plan.facebook.push({ nom: entite.nom, handle: meta.facebook, role: entite.role });
    if (bluesky) plan.bluesky.push({ nom: entite.nom, handle: bluesky, role: entite.role });
    if (sur) plan.threads.push({ nom: entite.nom, handle: meta.instagram, role: entite.role });

    const trouve = [meta.instagram && 'Instagram', bluesky && 'Bluesky', sur && 'Threads', meta.x && 'X'].filter(Boolean);
    log(`   Comptes « ${entite.nom} » (${entite.role}) : ${trouve.join(', ') || 'aucun, pas de mention'}`);
  }

  // Places restantes comblées par les comptes de référence, jamais l'inverse : ceux que l'article
  // nomme passent toujours devant. Deux sources, dans cet ordre — la table écrite à la main, puis
  // la découverte automatique, dont les trouvailles sont mémorisées et deviennent l'annuaire.
  const appris = domaines.length ? await annuaire(domaines, { log }) : {};
  for (const [reseau, liste] of Object.entries(plan)) {
    if (liste.length >= max) continue;
    const candidats = [
      ...(texte ? comptesThematiques(texte, reseau) : []),
      ...(appris[reseau] ?? []),
    ].filter((c, i, tout) => tout.findIndex((x) => fold(x.handle) === fold(c.handle)) === i
      && !liste.some((x) => fold(x.handle) === fold(c.handle)));
    for (const c of rotation(candidats, recents, max - liste.length)) {
      liste.push(c);
      log(`   Compte de référence « ${c.nom} » ajouté sur ${reseau} : @${c.handle}`);
    }
  }
  return plan;
}
