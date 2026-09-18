import { lienPublic } from '../channels/bluesky.mjs';

// Lien direct de chaque publication (bsky.app, instagram.com/p/…, facebook.com/…/posts/…, threads.com/…).
// Il est relevé à la publication depuis le 18/09/2026 ; pour les publications plus anciennes, on le
// retrouve à partir de l'identifiant conservé dans l'historique : sans réseau pour Bluesky, par une
// lecture de l'API pour les autres. Quelques-unes par passage, et un seul essai par publication.
const V = () => process.env.GRAPH_VERSION || 'v23.0';
const PAR_PASSAGE = 12;

async function lire(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  return json;
}

export const LECTEURS = {
  bluesky: async (id) => lienPublic(id),
  instagram: async (id) => (await lire(`https://graph.facebook.com/${V()}/${id}?fields=permalink&access_token=${process.env.IG_TOKEN}`)).permalink,
  facebook: async (id) => (await lire(`https://graph.facebook.com/${V()}/${id}?fields=permalink_url&access_token=${process.env.FB_TOKEN}`)).permalink_url,
  threads: async (id) => (await lire(`https://graph.threads.net/v1.0/${id}?fields=permalink&access_token=${process.env.THREADS_TOKEN}`)).permalink,
};

// Publications à compléter : un identifiant réel, pas encore de lien, jamais tentées
export const aCompleter = (history) => history.filter((e) => !e.lienPost && !e.lienCherche && LECTEURS[e.channel] && e.mediaId && !String(e.mediaId).startsWith('kit'));

export async function completerLiens(history, { lecteurs = LECTEURS, log = console.log } = {}) {
  const liste = aCompleter(history).slice(-PAR_PASSAGE);
  let trouves = 0;
  for (const e of liste) {
    e.lienCherche = true;
    try {
      const lien = await lecteurs[e.channel](e.mediaId);
      if (lien) {
        e.lienPost = lien;
        trouves += 1;
      }
    } catch (err) {
      log(`   Lien ${e.channel} introuvable (${err.message})`);
    }
  }
  if (liste.length) log(`Liens des publications : ${trouves}/${liste.length} retrouvés.`);
  return trouves;
}
