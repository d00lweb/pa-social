import { loadJson, saveJson } from '../core/state.mjs';
import { verdictSpam } from './moderation.mjs';

// Relevé des interactions, réseau par réseau. Lecture seule : rien n'est publié, rien n'est modifié.
// Ce qui est accessible aujourd'hui sans permission supplémentaire :
//   Instagram  : likes, commentaires        (portée : nécessite instagram_manage_insights)
//   Facebook   : likes, commentaires, partages (portée : nécessite read_insights)
//   Bluesky    : likes, reposts, réponses, citations — API publique, gratuite
//   Threads    : likes, réponses, reposts, vues — nécessite threads_manage_insights
const V = () => process.env.GRAPH_VERSION || 'v23.0';

// Version du comptage des commentaires : 2 = les seuls commentaires de lecteurs (voir plus bas).
// Un relevé d'une version antérieure est recompté, sur ce qui avait été écrit avant sa date.
export const VERSION_COMPTAGE = 2;

const vide = { likes: null, commentairesBruts: null, partages: null, vues: null, liste: null };

async function graph(chemin, params, token) {
  const res = await fetch(`https://graph.facebook.com/${V()}/${chemin}?${new URLSearchParams({ ...params, access_token: token })}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  return json;
}

// Toutes les pages d'une liste Graph (Instagram, Facebook, Threads), 300 éléments au plus
async function pages(url) {
  const out = [];
  for (let suivante = url; suivante && out.length < 300;) {
    const res = await fetch(suivante);
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new Error(j.error?.message ?? `HTTP ${res.status}`);
    out.push(...(j.data ?? []));
    suivante = j.paging?.next ?? null;
  }
  return out;
}

// Commentaires de lecteurs. Ce que les réseaux annoncent compte aussi nos propres réponses (le lien
// posté en réponse sur Threads et Bluesky, en premier commentaire sur les anciens posts Facebook) et
// le spam qu'Instagram a déjà caché sans le retirer du total. Relevé du 06/10/2026 : 17 à 33
// commentaires annoncés sous les posts Instagram, 0 à 5 lisibles, et parmi ces 25 lisibles, 8 de
// lecteurs. On ne compte donc que les commentaires lisibles, d'un autre que nous, qui ne sont pas du
// spam, et écrits avant le relevé.
export function commentairesDeLecteurs(liste, { avant = Infinity } = {}) {
  return liste.filter((c) => {
    const date = c.date ? Date.parse(c.date) : NaN;
    return !c.nous && !c.masque && !(date > avant) && !verdictSpam(c.texte);
  }).length;
}

const lecteurs = {
  async instagram(entree) {
    const j = await graph(entree.mediaId, { fields: 'like_count,comments_count' }, process.env.IG_TOKEN);
    // Les commentaires que le filtre d'Instagram a cachés n'apparaissent pas ici : ils sont comptés
    // dans comments_count, jamais dans la liste. Le robot ne commente pas sur Instagram.
    const params = new URLSearchParams({ fields: 'id,text,timestamp,hidden', limit: '100', access_token: process.env.IG_TOKEN });
    const liste = (await pages(`https://graph.facebook.com/${V()}/${entree.mediaId}/comments?${params}`))
      .map((c) => ({ texte: c.text ?? '', date: c.timestamp, masque: Boolean(c.hidden) }));
    return { ...vide, likes: j.like_count ?? null, commentairesBruts: j.comments_count ?? null, liste };
  },

  async facebook(entree) {
    const j = await graph(entree.mediaId, { fields: 'likes.summary(true),comments.summary(true),shares' }, process.env.FB_TOKEN);
    // la page elle-même : l'identifiant de la page, ou celui qui préfixe l'identifiant du post
    const page = new Set([process.env.FB_PAGE_ID, String(entree.mediaId).split('_')[0]].filter(Boolean));
    const params = new URLSearchParams({ fields: 'id,message,created_time,from', filter: 'stream', limit: '100', access_token: process.env.FB_TOKEN });
    const liste = (await pages(`https://graph.facebook.com/${V()}/${entree.mediaId}/comments?${params}`))
      .map((c) => ({ texte: c.message ?? '', date: c.created_time, nous: page.has(c.from?.id) }));
    return {
      ...vide,
      likes: j.likes?.summary?.total_count ?? null,
      commentairesBruts: j.comments?.summary?.total_count ?? null,
      partages: j.shares?.count ?? 0,
      liste,
    };
  },

  async bluesky(entree) {
    const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(entree.mediaId)}&depth=1&parentHeight=0`);
    const j = await res.json().catch(() => ({}));
    const p = j.thread?.post;
    if (!p) throw new Error('post introuvable');
    const auteur = p.author?.did;
    const liste = (j.thread.replies ?? []).filter((r) => r.post).map((r) => ({
      texte: r.post.record?.text ?? '', date: r.post.record?.createdAt ?? r.post.indexedAt, nous: r.post.author?.did === auteur,
    }));
    return { ...vide, likes: p.likeCount ?? 0, commentairesBruts: p.replyCount ?? 0, partages: (p.repostCount ?? 0) + (p.quoteCount ?? 0), liste };
  },

  async threads(entree) {
    const res = await fetch(`https://graph.threads.net/v1.0/${entree.mediaId}/insights?${new URLSearchParams({ metric: 'likes,replies,reposts,views', access_token: process.env.THREADS_TOKEN })}`);
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new Error(j.error?.message ?? `HTTP ${res.status}`);
    const v = Object.fromEntries((j.data ?? []).map((d) => [d.name, d.values?.[0]?.value ?? d.total_value?.value ?? null]));
    const params = new URLSearchParams({ fields: 'id,text,timestamp,is_reply_owned_by_me,hide_status', access_token: process.env.THREADS_TOKEN });
    const liste = (await pages(`https://graph.threads.net/v1.0/${entree.mediaId}/replies?${params}`)).map((r) => ({
      texte: r.text ?? '', date: r.timestamp, nous: r.is_reply_owned_by_me === true, masque: /HIDDEN/.test(String(r.hide_status ?? '')),
    }));
    return { ...vide, likes: v.likes ?? null, commentairesBruts: v.replies ?? null, partages: v.reposts ?? null, vues: v.views ?? null, liste };
  },
};

// Les chiffres d'un relevé : les commentaires de lecteurs comptés, la liste elle-même jamais gardée
// (state/ est public, et un commentaire appartient à son auteur).
function chiffresDe({ liste, ...brut }, { avant = Infinity } = {}) {
  return { ...brut, commentaires: liste ? commentairesDeLecteurs(liste, { avant }) : null, v: VERSION_COMPTAGE };
}

const JOUR = 86400e3;
const age = (entree, maintenant) => Math.floor((maintenant - new Date(entree.at).getTime()) / JOUR);

// Un relevé à J+1 (premier élan) et un à J+7 (portée réelle) : deux photos suffisent à comparer.
export const JALONS = [1, 7];

export function aRelever(history, mesures, maintenant = Date.now()) {
  const faits = new Set(mesures.map((m) => `${m.guid}|${m.channel}|${m.jalon}`));
  const a = [];
  for (const e of history) {
    if (!lecteurs[e.channel] || !e.mediaId || e.mediaId === 'kit-telegram') continue;
    for (const jalon of JALONS) {
      if (age(e, maintenant) >= jalon && !faits.has(`${e.guid}|${e.channel}|${jalon}`)) a.push({ entree: e, jalon });
    }
  }
  return a;
}

// Relevés d'avant le comptage des seuls lecteurs : leurs commentaires sont recomptés sur ce qui avait
// été écrit avant leur date, quelques-uns par passage. Likes, partages et vues ne bougent pas : ils
// étaient justes. Ce qu'annonçait le réseau reste dans commentairesBruts.
export const A_RECOMPTER_PAR_PASSAGE = 40;
export async function recompter(mesures, history, { log = () => {}, lire = lecteurs } = {}) {
  const anciens = mesures.filter((m) => !m.introuvable && m.v !== VERSION_COMPTAGE && lire[m.channel] && m.mediaId).slice(0, A_RECOMPTER_PAR_PASSAGE);
  let faits = 0;
  for (const m of anciens) {
    const entree = history.find((e) => e.guid === m.guid && e.channel === m.channel) ?? { channel: m.channel, mediaId: m.mediaId };
    try {
      const { commentaires } = chiffresDe(await lire[m.channel]({ ...entree, mediaId: m.mediaId }), { avant: Date.parse(m.releveLe) });
      m.commentairesBruts ??= m.commentaires;
      m.commentaires = commentaires;
      faits++;
    } catch (err) {
      // post disparu : rien à recompter. Le chiffre d'origine reste dans commentairesBruts, mais il
      // ne compte plus — il pouvait être du spam. Une autre erreur (réseau, quota) se retente.
      if (!/does not exist|Unsupported get request|Object with ID|introuvable/i.test(err.message)) continue;
      m.commentairesBruts ??= m.commentaires;
      m.commentaires = null;
    }
    m.v = VERSION_COMPTAGE;
  }
  if (anciens.length) log(`Mesures : ${faits} relevé(s) ancien(s) recompté(s) sans spam ni réponses du robot.`);
  return anciens.length;
}

// Relève ce qui est dû et enrichit state/mesures.json. N'écrase jamais un relevé existant.
export async function collecter({ log = console.log, maintenant = Date.now(), lire = lecteurs } = {}) {
  const history = await loadJson('published.json', []);
  const mesures = await loadJson('mesures.json', []);
  const attendus = aRelever(history, mesures, maintenant);
  const recomptes = await recompter(mesures, history, { log, lire });
  if (!attendus.length) {
    if (recomptes) await saveJson('mesures.json', mesures);
    log('Mesures : rien à relever.');
    return mesures;
  }

  let releves = 0;
  for (const { entree, jalon } of attendus) {
    try {
      const chiffres = chiffresDe(await lire[entree.channel](entree), { avant: maintenant });
      mesures.push({
        guid: entree.guid,
        channel: entree.channel,
        mediaId: entree.mediaId,
        publieLe: entree.at,
        jalon,
        releveLe: new Date(maintenant).toISOString(),
        ...chiffres,
      });
      releves++;
    } catch (err) {
      // un post supprimé ou une permission manquante ne doit pas interrompre le relevé
      log(`   Mesure ${entree.channel} J+${jalon} impossible : ${err.message}`);
      // Post introuvable chez le réseau (supprimé, ou publication qui n'a jamais abouti) : le
      // relevé est clos pour ce jalon. Sans cela, le même échec repart à chaque passage, indéfiniment.
      if (/does not exist|Unsupported get request|Object with ID/i.test(err.message)) {
        mesures.push({ guid: entree.guid, channel: entree.channel, publieLe: entree.at, jalon, releveLe: new Date(maintenant).toISOString(), introuvable: true });
      }
    }
  }
  await saveJson('mesures.json', mesures);
  log(`Mesures : ${releves} relevé(s) sur ${attendus.length} attendu(s).`);
  return mesures;
}
