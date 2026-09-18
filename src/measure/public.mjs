import { uploadFiles } from '../storage/ftp.mjs';
import { loadJson } from '../core/state.mjs';
import { config } from '../core/config.mjs';
import { dayKey } from '../core/scheduler.mjs';
import { evolution, resumeSemaine } from './abonnes.mjs';
import { interactions, parPost } from './rapport.mjs';

// Données de la page publique de l'équipe (site/reseaux-sociaux.html), déposées sur le site dans
// /social/reseaux.json à chaque passage. La page est ouverte à quiconque a son adresse : ce fichier
// est donc construit par LISTE BLANCHE, champ par champ. Rien d'interne n'y entre : ni identifiant
// de média, ni erreur, ni pause, ni validation, ni raison de report, ni jeton, ni lien vers le dépôt.
// Seuls les réseaux suivis publiquement y figurent ; X, publié à la main, n'y est pas.
const TZ = config.timezone;
export const PUBLICS = ['facebook', 'instagram', 'threads', 'bluesky'];
const JOUR = 86400e3;

// Liens et images n'entrent que s'ils pointent vers un domaine attendu : la page n'affichera jamais
// autre chose qu'un article du site, un visuel du site ou un post de nos comptes.
const SITE = 'passion-aquitaine.ouest-france.fr';
const DOMAINES_POSTS = ['instagram.com', 'facebook.com', 'threads.com', 'threads.net', 'bsky.app'];

function urlSure(u, domaines) {
  try {
    const url = new URL(String(u));
    if (url.protocol !== 'https:') return null;
    const hote = url.hostname.replace(/^www\./, '');
    return domaines.some((d) => hote === d || hote.endsWith(`.${d}`)) ? url.href : null;
  } catch {
    return null;
  }
}
export const lienArticle = (u) => urlSure(u, [SITE]);
export const lienPost = (u) => urlSure(u, DOMAINES_POSTS);
export const image = (u) => urlSure(u, [SITE]);

const texte = (s, max = 160) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};
const iso = (t) => new Date(t).toISOString();
const entier = (n) => (Number.isFinite(n) ? Math.round(n) : null);

// Le visuel d'un article : la photo de l'article dans le flux, nette et trois à dix fois plus légère
// que les visuels composés pour les réseaux (titre incrusté, qui serait rogné) ; à défaut, celui du post.
function visuel(history, e, flux) {
  return image(flux.get(e.guid)?.image) ?? image(e.apercu?.image) ?? image(history.find((x) => x.guid === e.guid && x.apercu?.image)?.apercu.image);
}

// Les premières publications (avant le 17/09/2026) n'ont que l'identifiant de l'article dans
// l'historique : le titre et le lien sont repris du flux RSS, qui couvre les articles récents.
const titreDe = (history, e, flux) => e.titre || history.find((x) => x.guid === e.guid && x.titre)?.titre || flux.get(e.guid)?.title || '';
const lienDe = (e, flux) => lienPost(e.lienPost) ?? lienArticle(e.lien) ?? lienArticle(flux.get(e.guid)?.link);

export function construirePublic({ history = [], queue = [], mesures = [], releves = {}, controls = {}, articles = [], maintenant = Date.now(), canaux = config.channels } = {}) {
  const flux = new Map(articles.filter((a) => a?.guid).map((a) => [a.guid, a]));
  const jour = dayKey(maintenant, TZ);
  const moisCle = jour.slice(0, 7);
  const actifs = PUBLICS.filter((id) => canaux[id] && canaux[id].enabled !== false && !controls.paused?.[id]);
  const publics = history.filter((e) => e.at && PUBLICS.includes(e.channel));
  const duMois = publics.filter((e) => dayKey(Date.parse(e.at), TZ).startsWith(moisCle));
  const semaine = resumeSemaine(releves, maintenant, TZ);
  const debut = Object.keys(releves).sort()[0] ?? null;

  const reseaux = PUBLICS.filter((id) => canaux[id]).map((id) => {
    const serie = Object.keys(releves).sort()
      .filter((j) => Number.isFinite(releves[j]?.[id]))
      .map((j) => [j, releves[j][id]]);
    const total = debut ? evolution(releves, id, debut, jour) : null;
    const mois = evolution(releves, id, `${moisCle}-01`, jour);
    const siens = publics.filter((e) => e.channel === id);
    return {
      id,
      abonnes: entier(serie.at(-1)?.[1]),
      gainSemaine: entier(semaine[id]?.gain),
      gainTotal: entier(total?.gain),
      gainMois: entier(mois?.gain),
      postsSemaine: siens.filter((e) => Date.parse(e.at) >= maintenant - 7 * JOUR).length,
      postsMois: duMois.filter((e) => e.channel === id).length,
      dernier: siens.at(-1) ? iso(siens.at(-1).at) : null,
      creneaux: (canaux[id].creneaux ?? []).map(([a, b]) => [String(a), String(b)]),
      serie,
    };
  });

  // Programmées et confirmées uniquement : ce qui attend encore un feu vert n'est pas annoncé.
  // Une publication passée de peu reste affichée le temps que le post soit en ligne.
  const planning = queue
    .filter((q) => q.status === 'pending' && actifs.includes(q.channel) && q.dueAt >= maintenant - 30 * 60e3 && q.dueAt <= maintenant + 4 * JOUR)
    .sort((a, b) => a.dueAt - b.dueAt)
    .slice(0, 20)
    .map((q) => ({
      reseau: q.channel,
      heure: iso(q.dueAt),
      titre: texte(q.article?.title),
      lien: lienArticle(q.article?.link),
      image: image(q.article?.image),
    }));

  // Un article par carte, avec chaque réseau où il est paru : plus lisible que quatre fois le même
  // visuel à la suite. Rangés par dernière parution.
  const parArticle = new Map();
  for (const e of publics) {
    const titre = titreDe(history, e, flux);
    if (!titre) continue;
    const a = parArticle.get(e.guid) ?? { titre: texte(titre), lien: lienArticle(e.lien) ?? lienArticle(flux.get(e.guid)?.link), image: null, heure: e.at, reseaux: [] };
    a.image ??= visuel(history, e, flux);
    if (Date.parse(e.at) > Date.parse(a.heure)) a.heure = e.at;
    a.reseaux = a.reseaux.filter((r) => r.reseau !== e.channel);
    a.reseaux.push({ reseau: e.channel, heure: iso(e.at), lien: lienDe(e, flux) });
    parArticle.set(e.guid, a);
  }
  const publications = [...parArticle.values()]
    .sort((a, b) => Date.parse(b.heure) - Date.parse(a.heure))
    .slice(0, 8)
    .map((a) => ({ ...a, heure: iso(a.heure), reseaux: a.reseaux.sort((x, y) => PUBLICS.indexOf(x.reseau) - PUBLICS.indexOf(y.reseau)) }));

  // Les interactions relevées sur les posts du mois (likes, commentaires, partages)
  const mesuresMois = parPost(mesures).filter((m) => PUBLICS.includes(m.channel) && m.publieLe && dayKey(Date.parse(m.publieLe), TZ).startsWith(moisCle));
  const top = mesuresMois
    .map((m) => ({ m, e: history.find((x) => x.guid === m.guid && x.channel === m.channel) ?? { guid: m.guid, channel: m.channel } }))
    .filter(({ e }) => titreDe(history, e, flux))
    .sort((a, b) => interactions(b.m) - interactions(a.m))
    .slice(0, 5)
    .filter(({ m }) => interactions(m) > 0)
    .map(({ m, e }) => ({
      reseau: m.channel,
      titre: texte(titreDe(history, e, flux)),
      lien: lienDe(e, flux),
      image: visuel(history, e, flux),
      interactions: interactions(m),
    }));

  return {
    majLe: iso(maintenant),
    depuis: debut,
    reseaux,
    planning,
    publications,
    mois: {
      cle: moisCle,
      publications: duMois.length,
      interactions: mesuresMois.reduce((n, m) => n + interactions(m), 0),
      articles: new Set(duMois.map((e) => e.guid)).size,
      top,
    },
  };
}

// Dépôt sur le site, à côté des visuels : un échec ne doit jamais gêner les publications.
export async function publierPublic(contexte, { log = console.log } = {}) {
  const [mesures, releves] = await Promise.all([loadJson('mesures.json', []), loadJson('abonnes.json', {})]);
  const donnees = construirePublic({ ...contexte, mesures, releves });
  await uploadFiles([{ name: 'reseaux.json', buffer: Buffer.from(JSON.stringify(donnees)) }], {
    host: process.env.SFTP_HOST,
    user: process.env.SFTP_USER,
    pass: process.env.SFTP_PASS,
    dir: process.env.SFTP_DIR,
  });
  log(`Page équipe : données déposées (${donnees.planning.length} à venir, ${donnees.publications.length} articles récents).`);
  return donnees;
}
