import { loadJson, saveJson } from '../core/state.mjs';

// Relevé des interactions, réseau par réseau. Lecture seule : rien n'est publié, rien n'est modifié.
// Ce qui est accessible aujourd'hui sans permission supplémentaire :
//   Instagram  : likes, commentaires        (portée : nécessite instagram_manage_insights)
//   Facebook   : likes, commentaires, partages (portée : nécessite read_insights)
//   Bluesky    : likes, reposts, réponses, citations — API publique, gratuite
//   Threads    : likes, réponses, reposts, vues — nécessite threads_manage_insights
const V = () => process.env.GRAPH_VERSION || 'v23.0';

const vide = { likes: null, commentaires: null, partages: null, vues: null };

async function graph(chemin, params, token) {
  const res = await fetch(`https://graph.facebook.com/${V()}/${chemin}?${new URLSearchParams({ ...params, access_token: token })}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  return json;
}

const lecteurs = {
  async instagram(entree) {
    const j = await graph(entree.mediaId, { fields: 'like_count,comments_count' }, process.env.IG_TOKEN);
    return { ...vide, likes: j.like_count ?? null, commentaires: j.comments_count ?? null };
  },

  async facebook(entree) {
    const j = await graph(entree.mediaId, { fields: 'likes.summary(true),comments.summary(true),shares' }, process.env.FB_TOKEN);
    return {
      ...vide,
      likes: j.likes?.summary?.total_count ?? null,
      commentaires: j.comments?.summary?.total_count ?? null,
      partages: j.shares?.count ?? 0,
    };
  },

  async bluesky(entree) {
    const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(entree.mediaId)}`);
    const j = await res.json().catch(() => ({}));
    const p = j.posts?.[0];
    if (!p) throw new Error('post introuvable');
    return { ...vide, likes: p.likeCount ?? 0, commentaires: p.replyCount ?? 0, partages: (p.repostCount ?? 0) + (p.quoteCount ?? 0) };
  },

  async threads(entree) {
    const res = await fetch(`https://graph.threads.net/v1.0/${entree.mediaId}/insights?${new URLSearchParams({ metric: 'likes,replies,reposts,views', access_token: process.env.THREADS_TOKEN })}`);
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new Error(j.error?.message ?? `HTTP ${res.status}`);
    const v = Object.fromEntries((j.data ?? []).map((d) => [d.name, d.values?.[0]?.value ?? d.total_value?.value ?? null]));
    return { ...vide, likes: v.likes ?? null, commentaires: v.replies ?? null, partages: v.reposts ?? null, vues: v.views ?? null };
  },
};

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

// Relève ce qui est dû et enrichit state/mesures.json. N'écrase jamais un relevé existant.
export async function collecter({ log = console.log, maintenant = Date.now() } = {}) {
  const history = await loadJson('published.json', []);
  const mesures = await loadJson('mesures.json', []);
  const attendus = aRelever(history, mesures, maintenant);
  if (!attendus.length) {
    log('Mesures : rien à relever.');
    return mesures;
  }

  let releves = 0;
  for (const { entree, jalon } of attendus) {
    try {
      const chiffres = await lecteurs[entree.channel](entree);
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
