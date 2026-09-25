import { loadJson, saveJson } from '../core/state.mjs';
import { config } from '../core/config.mjs';

// Modération des commentaires : les robots publicitaires répètent la même adresse sous chaque
// publication. Relevé le 25/09/2026 sur @lovaquitaine : 26 commentaires sous un seul post, 16 sous
// un autre, tous pour le même site.
//
// Ces messages sont écrits pour passer les filtres par mot-clé : la marque y est déguisée avec des
// caractères qui ressemblent à des lettres latines sans en être — « tepu.𝐥𝐨𝐥 » en gras
// mathématique, « lоl » avec un о cyrillique, « g00gle », « s!te », « navigatеur » — et truffée de
// caractères invisibles. D'où la normalisation ci-dessous, qui ramène tout à l'alphabet latin avant
// de comparer : c'est elle qui fait la différence entre un filtre contourné en dix secondes et un
// filtre qui tient.

const SPAM = config.moderation ?? {};
export const MOTIFS = SPAM.motifs ?? [];
export const SEUIL_DOUBLONS = SPAM.seuilDoublons ?? 2;

// Lettres non latines qui imitent une lettre latine, et variantes typographiques d'Unicode.
const SOSIES = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ѕ: 's', ј: 'j', ԁ: 'd', һ: 'h', ν: 'v', ο: 'o', ρ: 'p', τ: 't', α: 'a', ε: 'e', ι: 'i', κ: 'k', μ: 'm', 𝐥: 'l', 𝐨: 'o',
};

// Ramène un texte à sa forme comparable : sosies remplacés, accents et caractères invisibles
// retirés, chiffres et symboles de substitution rendus à leur lettre, ponctuation supprimée.
export function normaliser(texte) {
  let s = String(texte ?? '').toLowerCase();
  s = s.replace(/[​-‏⁠﻿­]/g, '');           // caractères invisibles
  s = [...s].map((c) => SOSIES[c] ?? c).join('');
  s = s.normalize('NFKD').replace(/\p{M}/gu, '');                     // gras mathématique, accents
  s = [...s].map((c) => SOSIES[c] ?? c).join('');                     // sosies révélés par NFKD
  s = s.replace(/[0@]/g, 'o').replace(/[1!|]/g, 'i').replace(/3/g, 'e').replace(/\$/g, 's');
  return s.replace(/[^\p{L}\p{N}]/gu, '');
}

// Un commentaire est-il un spam certain ? Les motifs viennent de config/moderation.json : ce sont
// des marques, pas des mots ordinaires, pour qu'aucun commentaire de lecteur n'y tombe par hasard.
export function motifTrouve(texte, motifs = MOTIFS) {
  const n = normaliser(texte);
  return motifs.find((m) => n.includes(normaliser(m))) ?? null;
}

// Verdict pour une liste de commentaires portant sur plusieurs publications.
// · un motif connu  → suppression, le doute n'existe pas ;
// · un texte identique répété sous plusieurs publications, avec une adresse dedans → masquage,
//   réversible, parce que la règle est plus large et pourrait se tromper ;
// · le reste est laissé tel quel.
export function trier(commentaires, { motifs = MOTIFS, seuil = SEUIL_DOUBLONS } = {}) {
  const parTexte = new Map();
  for (const c of commentaires) {
    const n = normaliser(c.texte);
    if (!n) continue;
    const vu = parTexte.get(n) ?? new Set();
    vu.add(c.publication);
    parTexte.set(n, vu);
  }
  const adresse = /(\w{3,}\s*[.．]\s*(lol|com|net|xyz|top|site|shop|club|online|live|fr)\b)|https?:\/\//i;

  const verdicts = [];
  for (const c of commentaires) {
    const motif = motifTrouve(c.texte, motifs);
    if (motif) {
      verdicts.push({ ...c, action: 'supprimer', raison: `motif « ${motif} »` });
      continue;
    }
    const publications = parTexte.get(normaliser(c.texte))?.size ?? 1;
    if (publications >= seuil && adresse.test(String(c.texte))) {
      verdicts.push({ ...c, action: 'masquer', raison: `même texte sous ${publications} publications, avec une adresse` });
    }
  }
  return verdicts;
}

// ── Passage sur les commentaires réels ────────────────────────────────────────
const V = () => process.env.GRAPH_VERSION || 'v23.0';
const PUBLICATIONS_SUIVIES = SPAM.publicationsSuivies ?? 12;

async function appel(url, options) {
  const r = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
  return j;
}

// Commentaires des dernières publications Instagram, à plat
async function commentairesInstagram(history, lire) {
  const posts = history.filter((e) => e.channel === 'instagram' && e.mediaId && !String(e.mediaId).startsWith('kit')).slice(-PUBLICATIONS_SUIVIES);
  const out = [];
  for (const p of posts) {
    const j = await lire(`https://graph.facebook.com/${V()}/${p.mediaId}/comments?fields=id,text,timestamp,hidden&limit=50&access_token=${process.env.IG_TOKEN}`);
    for (const c of j.data ?? []) {
      if (c.hidden) continue;
      out.push({ id: c.id, texte: c.text ?? '', publication: p.mediaId, titre: p.titre, date: c.timestamp });
    }
  }
  return out;
}

// Relève les commentaires, supprime ou masque ce qui est du spam, rend le compte rendu.
// Sans le droit `instagram_manage_comments`, rien n'est modifié : le passage se contente de
// compter, et le dit une fois par jour, pour que le silence ne passe pas pour une absence de spam.
export async function modererCommentaires({ history = [], log = console.log, lire = appel, ecrire = appel, now = Date.now(), envoyer } = {}) {
  if (!process.env.IG_TOKEN || !MOTIFS.length) return { verdicts: [], traites: 0 };
  let commentaires;
  try {
    commentaires = await commentairesInstagram(history, lire);
  } catch (e) {
    log(`   Modération : lecture impossible (${e.message})`);
    return { verdicts: [], traites: 0 };
  }

  const verdicts = trier(commentaires);
  if (!verdicts.length) {
    log(`Modération : ${commentaires.length} commentaires lus, aucun spam.`);
    return { verdicts, traites: 0 };
  }

  let traites = 0;
  let refus = null;
  for (const v of verdicts) {
    try {
      if (v.action === 'supprimer') await ecrire(`https://graph.facebook.com/${V()}/${v.id}?access_token=${process.env.IG_TOKEN}`, { method: 'DELETE' });
      else await ecrire(`https://graph.facebook.com/${V()}/${v.id}?hide=true&access_token=${process.env.IG_TOKEN}`, { method: 'POST' });
      traites += 1;
    } catch (e) {
      refus = e;
      break; // un droit manquant vaut pour tous : inutile d'insister 26 fois
    }
  }

  log(`Modération : ${verdicts.length} spam${verdicts.length > 1 ? 's' : ''} sur ${commentaires.length} commentaires, ${traites} traité${traites > 1 ? 's' : ''}.`);
  if (refus) {
    log(`   Modération impossible : ${refus.message}`);
    await prevenirDroitManquant(verdicts.length, refus, { now, envoyer, log });
  }
  return { verdicts, traites, refus };
}

// Une alerte par jour au plus : le spam arrive en rafale, le message ne doit pas la suivre.
async function prevenirDroitManquant(combien, err, { now, envoyer, log }) {
  const memo = await loadJson('moderation.json', {});
  const jour = new Date(now).toISOString().slice(0, 10);
  if (memo.alerte === jour) return;
  memo.alerte = jour;
  await saveJson('moderation.json', memo);
  const texte = `🧹 <b>${combien} commentaire${combien > 1 ? 's' : ''} de spam</b> détecté${combien > 1 ? 's' : ''} sur Instagram, mais le jeton ne permet pas de les retirer.\n`
    + `<i>${err.code === 10 ? 'Droit manquant : instagram_manage_comments' : err.message}</i>\n\n`
    + 'En attendant, le filtre d’Instagram les arrête à la source : Paramètres → Confidentialité du compte → <b>Mots masqués</b> → Mots-clés personnalisés.';
  const envoi = envoyer ?? (await import('../channels/telegram.mjs')).alert;
  await envoi(texte).catch((e) => log(`   Alerte modération non envoyée : ${e.message}`));
}
