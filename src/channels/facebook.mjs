import { GraphError } from './meta-graph.mjs';
import { GuardError } from '../core/errors.mjs';

// Facebook : publication avec lien. Le texte tient en une phrase, et Facebook fabrique sous lui
// une carte d'aperçu (image, titre, domaine) à partir des balises Open Graph de l'article.
//
// Pourquoi ce format, décidé le 23/09/2026 : les huit premières publications — visuel 4:5 habillé,
// texte reprenant le titre, lien en premier commentaire — ont fait 0 réaction et 0 clic. Le lien en
// commentaire n'est plus qu'une légende de 2018 ; surtout, il obligeait à ouvrir les commentaires
// pour trouver l'article. Ici, la carte reste cliquable en entier, même quand le texte est replié
// derrière « Voir plus ».
export const id = 'facebook';

function client({ token, version }) {
  const base = `https://graph.facebook.com/${version || 'v23.0'}`;
  return async function call(chemin, params = {}) {
    const res = await fetch(`${base}/${chemin}`, { method: 'POST', body: new URLSearchParams({ ...params, access_token: token }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new GraphError(json.error ?? { message: 'réponse illisible' }, res.status);
    return json;
  };
}

// Le permalien ne se devine pas : dans le lien rendu par Meta, l'identifiant de page diffère
// de FB_PAGE_ID. Une URL reconstruite à la main serait fausse, il faut la demander.
async function lienDuPost(postId, { token, version }) {
  const params = new URLSearchParams({ fields: 'permalink_url', access_token: token });
  const res = await fetch(`https://graph.facebook.com/${version || 'v23.0'}/${postId}?${params}`, { signal: AbortSignal.timeout(15000) });
  const json = await res.json().catch(() => ({}));
  return json.permalink_url ?? null;
}

// Ce qui part réellement à Facebook. Fonction pure : c'est elle que les tests vérifient.
export function parametres(pkg) {
  const params = { message: pkg.text, link: pkg.lien, published: 'true' };
  if (pkg.lieu?.id) params.place = String(pkg.lieu.id);
  return params;
}

export async function prepare(article, { dossier, log = console.log } = {}) {
  const texte = dossier.facebook?.texte?.trim();
  if (!texte) throw new GuardError(article, ['texte Facebook vide']);
  // le lien est porté par la carte d'aperçu : dans le texte, il ferait doublon et mangerait la place
  if (/https?:\/\//.test(texte)) throw new GuardError(article, ['lien dans le texte Facebook : il est ajouté par la carte d’aperçu']);
  // un retour à la ligne pousse la fin du texte derrière « Voir plus » : une seule phrase, d'un bloc
  if (/[\r\n]/.test(texte)) throw new GuardError(article, ['retour à la ligne dans le texte Facebook : une seule phrase']);
  if (!article.link) throw new GuardError(article, ['aucun lien d’article à publier']);

  const lieu = dossier.lieu ?? null;
  log(`   Facebook : lien + aperçu, ${[...texte].length} caractères${lieu ? `, lieu ${lieu.nom}` : ''}`);
  return { article, dossier, text: texte, lien: article.link, lieu, files: [] };
}

export async function publish(pkg) {
  const call = client({ token: process.env.FB_TOKEN, version: process.env.GRAPH_VERSION });
  const pageId = process.env.FB_PAGE_ID;
  const params = parametres(pkg);

  let reponse;
  try {
    reponse = await call(`${pageId}/feed`, params);
  } catch (err) {
    // un lieu devenu invalide ne doit pas empêcher la publication
    if (!params.place) throw err;
    console.error(`   Lieu abandonné : ${err.message}`);
    delete params.place;
    reponse = await call(`${pageId}/feed`, params);
  }
  const postId = reponse.post_id ?? reponse.id;
  const lien = await lienDuPost(postId, { token: process.env.FB_TOKEN, version: process.env.GRAPH_VERSION }).catch(() => null);
  return { mediaId: postId, lien };
}
