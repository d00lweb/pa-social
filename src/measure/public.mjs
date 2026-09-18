import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { uploadFiles } from '../storage/ftp.mjs';
import { loadJson, saveJson } from '../core/state.mjs';
import { config } from '../core/config.mjs';
import { dayKey } from '../core/scheduler.mjs';
import { evolution, resumeSemaine } from './abonnes.mjs';
import { interactions, parPost } from './rapport.mjs';

// Données de la page publique de l'équipe (site/reseaux-sociaux.html), déposées sur le site dans
// /social/reseaux.json à chaque passage. La page est ouverte à quiconque a son adresse : ce fichier
// est donc construit par LISTE BLANCHE, champ par champ. Rien d'interne n'y entre : ni identifiant
// de média, ni erreur, ni pause, ni validation, ni raison de report, ni jeton, ni lien vers le dépôt.
const TZ = config.timezone;
export const PUBLICS = ['facebook', 'instagram', 'x', 'threads', 'bluesky'];
// Publiés à la main dès leur réception sur Telegram : le kit X, et la story qui suit chaque carrousel
export const MANUELS = new Set(['x']);
const JOUR = 86400e3;

// Liens et images n'entrent que s'ils pointent vers un domaine attendu : la page n'affichera jamais
// autre chose qu'un article du site, un visuel du site ou un post de nos comptes.
const SITE = 'passion-aquitaine.ouest-france.fr';
const DOMAINES_POSTS = ['instagram.com', 'facebook.com', 'threads.com', 'threads.net', 'bsky.app', 'x.com'];
const BASE_PUBLIQUE = () => (process.env.PUBLIC_BASE_URL || `https://${SITE}/social`).replace(/\/+$/, '');

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

// Les premières publications (avant le 17/09/2026) n'ont que l'identifiant de l'article dans
// l'historique : le titre et le lien sont repris du flux RSS, qui couvre les articles récents.
const titreDe = (history, e, flux) => e.titre || history.find((x) => x.guid === e.guid && x.titre)?.titre || flux.get(e.guid)?.title || '';
const articleDe = (history, e, flux) => lienArticle(e.lien) ?? lienArticle(history.find((x) => x.guid === e.guid && x.lien)?.lien) ?? lienArticle(flux.get(e.guid)?.link);

// Le visuel 4:5 composé pour les réseaux (rubrique, titre, fond rouge), celui d'Instagram d'abord.
// Tous sont au format 4:5, sauf la story, qui n'est pas publiée par cette voie.
// Les publications d'avant le 17/09/2026 n'ont pas retenu leur visuel, mais le carrousel Instagram
// est resté sur le site sous le nom qu'il reçoit à la publication (date de l'article + empreinte du
// guid) : on le retrouve par ce nom. S'il n'existe pas, la photo de l'article prend le relais.
const PRIORITE_VISUEL = ['instagram', 'facebook', 'threads', 'bluesky', 'x'];
export function visuelSource(history, guid, flux = new Map()) {
  const siens = history.filter((x) => x.guid === guid && image(x.apercu?.image) && x.apercu.image.startsWith(`${BASE_PUBLIQUE()}/`));
  siens.sort((a, b) => PRIORITE_VISUEL.indexOf(a.channel) - PRIORITE_VISUEL.indexOf(b.channel));
  if (siens[0]) return siens[0].apercu.image;
  const date = new Date(flux.get(guid)?.date ?? NaN);
  if (Number.isNaN(date.getTime()) || !history.some((x) => x.guid === guid && x.channel === 'instagram')) return null;
  const stamp = date.toISOString().slice(0, 10).replaceAll('-', '');
  return `${BASE_PUBLIQUE()}/${stamp}-${createHash('sha1').update(guid).digest('hex').slice(0, 8)}-1.jpg`;
}
// Vignette légère déposée à côté du visuel : 600 × 750, une soixantaine de Ko au lieu de 300 à 950
export const nomVignette = (source) => source.split('/').pop().replace(/\.(jpe?g|png)$/i, '') + '-vignette.jpg';

// Le visuel affiché pour un article : sa vignette 4:5 si elle existe, sinon la photo de l'article
function visuel(history, guid, flux, vignette) {
  const source = visuelSource(history, guid, flux);
  return (source && image(vignette(source))) ?? image(flux.get(guid)?.image) ?? null;
}

// Bilan d'un mois (aaaa-mm), sur les données encore présentes dans l'historique
function bilanMois(cle, { publics, history, mesures, releves, flux, vignette }) {
  const duMois = publics.filter((e) => dayKey(Date.parse(e.at), TZ).startsWith(cle));
  const mesuresMois = parPost(mesures).filter((m) => PUBLICS.includes(m.channel) && m.publieLe && dayKey(Date.parse(m.publieLe), TZ).startsWith(cle));
  const top = mesuresMois
    .map((m) => ({ m, e: history.find((x) => x.guid === m.guid && x.channel === m.channel) ?? { guid: m.guid, channel: m.channel } }))
    .filter(({ e }) => titreDe(history, e, flux))
    .sort((a, b) => interactions(b.m) - interactions(a.m))
    .slice(0, 5)
    .filter(({ m }) => interactions(m) > 0)
    .map(({ m, e }) => ({
      reseau: m.channel,
      titre: texte(titreDe(history, e, flux)),
      lien: lienPost(e.lienPost) ?? articleDe(history, e, flux),
      image: visuel(history, e.guid, flux, vignette),
      interactions: interactions(m),
    }));
  return {
    cle,
    publications: duMois.length,
    articles: new Set(duMois.map((e) => e.guid)).size,
    interactions: mesuresMois.reduce((n, m) => n + interactions(m), 0),
    parReseau: Object.fromEntries(PUBLICS.map((id) => [id, duMois.filter((e) => e.channel === id).length])),
    // abonnés gagnés sur le mois, compte par compte ; null tant qu'il n'y a pas deux relevés à comparer
    gains: Object.fromEntries(PUBLICS.map((id) => {
      const ev = evolution(releves, id, `${cle}-01`, `${cle}-31`);
      return [id, ev && ev.au > ev.depuis ? ev.gain : null];
    })),
    top,
  };
}

export function construirePublic({
  history = [], queue = [], mesures = [], releves = {}, controls = {}, articles = [], archive = {},
  vignette = () => null, maintenant = Date.now(), canaux = config.channels,
} = {}) {
  const flux = new Map(articles.filter((a) => a?.guid).map((a) => [a.guid, a]));
  const jour = dayKey(maintenant, TZ);
  const actifs = PUBLICS.filter((id) => canaux[id] && canaux[id].enabled !== false && !controls.paused?.[id]);
  const publics = history.filter((e) => e.at && PUBLICS.includes(e.channel));
  const semaine = resumeSemaine(releves, maintenant, TZ);
  const debut = Object.keys(releves).sort()[0] ?? null;

  const reseaux = PUBLICS.filter((id) => canaux[id]).map((id) => {
    const serie = Object.keys(releves).sort()
      .filter((j) => Number.isFinite(releves[j]?.[id]))
      .map((j) => [j, releves[j][id]]);
    const depuis = serie[0]?.[0] ?? null;
    const total = depuis ? evolution(releves, id, depuis, jour) : null;
    const siens = publics.filter((e) => e.channel === id);
    return {
      id,
      abonnes: entier(serie.at(-1)?.[1]),
      gainSemaine: entier(semaine[id]?.gain),
      gainTotal: entier(total?.gain),
      depuis,
      postsSemaine: siens.filter((e) => Date.parse(e.at) >= maintenant - 7 * JOUR).length,
      dernier: siens.at(-1) ? iso(siens.at(-1).at) : null,
      creneaux: (canaux[id].creneaux ?? []).map(([a, b]) => [String(a), String(b)]),
      serie,
    };
  });

  // Programmées et confirmées uniquement : ce qui attend encore un feu vert n'est pas annoncé.
  // Une publication passée de peu reste affichée le temps que le post soit en ligne.
  // Chaque carrousel Instagram est suivi de sa story, publiée à la main au même moment.
  const planning = [];
  const prevues = queue
    .filter((q) => q.status === 'pending' && actifs.includes(q.channel) && q.dueAt >= maintenant - 30 * 60e3 && q.dueAt <= maintenant + 4 * JOUR)
    .sort((a, b) => a.dueAt - b.dueAt);
  for (const q of prevues) {
    const base = { reseau: q.channel, heure: iso(q.dueAt), titre: texte(q.article?.title), lien: lienArticle(q.article?.link), image: image(q.article?.image) };
    planning.push({ ...base, format: null, manuel: MANUELS.has(q.channel) });
    if (q.channel === 'instagram') planning.push({ ...base, format: 'story', manuel: true });
  }

  // Un article par carte, avec chaque réseau où il est paru et le lien direct de chaque post
  const parArticle = new Map();
  for (const e of publics) {
    const titre = titreDe(history, e, flux);
    if (!titre) continue;
    const a = parArticle.get(e.guid) ?? { guid: e.guid, titre: texte(titre), lien: articleDe(history, e, flux), heure: e.at, reseaux: [] };
    if (Date.parse(e.at) > Date.parse(a.heure)) a.heure = e.at;
    a.reseaux = a.reseaux.filter((r) => r.reseau !== e.channel);
    a.reseaux.push({ reseau: e.channel, heure: iso(e.at), lien: lienPost(e.lienPost) });
    parArticle.set(e.guid, a);
  }
  const publications = [...parArticle.values()]
    .sort((a, b) => Date.parse(b.heure) - Date.parse(a.heure))
    .slice(0, 8)
    .map(({ guid, ...a }) => ({
      ...a,
      heure: iso(a.heure),
      image: visuel(history, guid, flux, vignette),
      reseaux: a.reseaux.sort((x, y) => PUBLICS.indexOf(x.reseau) - PUBLICS.indexOf(y.reseau)),
    }));

  // Bilans mensuels : recalculés tant que l'historique les contient, sinon repris de l'archive,
  // pour que la page puisse toujours revenir sur les mois passés.
  const cles = new Set([jour.slice(0, 7), ...publics.map((e) => dayKey(Date.parse(e.at), TZ).slice(0, 7))]);
  const contexte = { publics, history, mesures, releves, flux, vignette };
  const recalcules = Object.fromEntries([...cles].map((cle) => [cle, bilanMois(cle, contexte)]));
  const mois = Object.values({ ...archive, ...recalcules }).sort((a, b) => b.cle.localeCompare(a.cle));

  return { majLe: iso(maintenant), depuis: debut, reseaux, planning, publications, mois };
}

// Vignettes manquantes : téléchargées, réduites, prêtes à déposer. Une vignette déjà en ligne
// n'est pas refaite ; un visuel illisible est simplement ignoré (la photo de l'article prend le relais).
async function preparerVignettes(sources, { log }) {
  const base = BASE_PUBLIQUE();
  const connues = new Map();
  const aDeposer = [];
  await Promise.all([...sources].map(async (source) => {
    const nom = nomVignette(source);
    const url = `${base}/${nom}`;
    try {
      const deja = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
      if (deja.ok) return connues.set(source, url);
      const res = await fetch(source, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = await sharp(Buffer.from(await res.arrayBuffer()))
        .resize(600, 750, { fit: 'cover', position: 'top' })
        .jpeg({ quality: 72, mozjpeg: true })
        .toBuffer();
      aDeposer.push({ name: nom, buffer });
      connues.set(source, url);
    } catch (e) {
      log(`   Vignette ${nom} : ${e.message}`);
    }
  }));
  return { connues, aDeposer };
}

// Dépôt sur le site, à côté des visuels : un échec ne doit jamais gêner les publications.
export async function publierPublic(contexte, { log = console.log } = {}) {
  const [mesures, releves, archive] = await Promise.all([loadJson('mesures.json', []), loadJson('abonnes.json', {}), loadJson('mois-publics.json', {})]);
  const entree = { ...contexte, mesures, releves, archive };

  // premier passage à blanc pour savoir quels visuels la page va montrer
  const sources = new Set();
  construirePublic({ ...entree, vignette: (s) => { sources.add(s); return null; } });
  const { connues, aDeposer } = await preparerVignettes(sources, { log });

  const donnees = construirePublic({ ...entree, vignette: (s) => connues.get(s) ?? null });
  // les vignettes d'abord : le fichier de données ne doit jamais citer une image absente
  await uploadFiles([...aDeposer, { name: 'reseaux.json', buffer: Buffer.from(JSON.stringify(donnees)) }], {
    host: process.env.SFTP_HOST,
    user: process.env.SFTP_USER,
    pass: process.env.SFTP_PASS,
    dir: process.env.SFTP_DIR,
  });
  await saveJson('mois-publics.json', Object.fromEntries(donnees.mois.map((m) => [m.cle, m])));
  log(`Page équipe : données déposées (${donnees.planning.length} à venir, ${donnees.publications.length} articles récents${aDeposer.length ? `, ${aDeposer.length} vignette(s) créée(s)` : ''}).`);
  return donnees;
}
