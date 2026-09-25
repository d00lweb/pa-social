import { fold } from './geo.mjs';

const EMOJI = /\p{Extended_Pictographic}/u;
const HASHTAG = /^#[\p{L}\p{N}]+$/u;
const graphemes = (s) => [...String(s)].length;

// Suites de 3 mots : mesure la reprise de tournures, pas le partage du vocabulaire du sujet
function shingles(s, n = 3) {
  const w = fold(s).match(/\p{L}+|\d+/gu) ?? [];
  const set = new Set();
  for (let i = 0; i + n <= w.length; i++) set.add(w.slice(i, i + n).join(' '));
  return set;
}

// Part des tournures du texte le plus court reprises dans l'autre (0 à 1)
export function similarity(a, b) {
  const A = shingles(a);
  const B = shingles(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const s of A) if (B.has(s)) inter++;
  return inter / Math.min(A.size, B.size);
}

// Chiffres sans séparateurs de milliers : « 2 500 » → « 2500 »
const numbers = (s) => String(s).replace(/(\d)[   .](?=\d{3}\b)/g, '$1').match(/\d+(?:,\d+)?/g) ?? [];

// Mots à majuscule hors début de ligne ou de phrase, hors hashtag : noms propres à retrouver dans les données
function properNames(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    for (const m of line.matchAll(/\p{Lu}[\p{L}’'-]{3,}/gu)) {
      const raw = line.slice(0, m.index);
      if (raw.endsWith('#')) continue;
      const before = raw.replace(/[«"“(\s  ]+$/u, '');
      if (!before || /[.!?:…•\-–—⠀]$/u.test(before) || /\p{Extended_Pictographic}️?$/u.test(before)) continue;
      out.push(m[0].replace(/^[LD][’']/, ''));
    }
  }
  return out;
}

const tokens = (s) => String(s).split(/[\s  ]+/).filter(Boolean);

// Problèmes d'un dossier IA ; liste vide = publiable
const EMOJIS = /\p{Extended_Pictographic}️?/gu;
const bareEmoji = (e) => e.replace(/️/g, '');
export const extractEmojis = (text) => (String(text).match(EMOJIS) ?? []).map(bareEmoji);

export function checkDossier(d, { source, limits, stopwords, genericCategories, internalCategoryPattern, bannedHashtags, knownNames, similarityMax, memorySimilarityMax, memory = {}, questions = {}, baitPatterns = [], sensitiveEmojis = [], recentEmojis = {}, emojiPlacement = {}, rubriquesAutorisees = null }) {
  const problems = [];
  const stop = new Set(stopwords.map((w) => fold(w)));
  const src = fold(source);
  const srcNumbers = new Set(numbers(source));

  // rubrique
  const rub = fold(d.rubrique).trim();
  if (!rub) problems.push('rubrique vide');
  if (graphemes(d.rubrique) > limits.rubrique) problems.push(`rubrique trop longue (${limits.rubrique} max)`);
  if (genericCategories.includes(rub) || new RegExp(internalCategoryPattern, 'i').test(d.rubrique)) problems.push(`rubrique générique interdite : « ${d.rubrique} »`);
  // La rubrique est le seul texte que le contrôle anti-invention laissait passer : elle sert
  // elle-même de référence aux autres. Or elle s'affiche en gros sur le visuel, et une zone
  // d'identité inventée y devient un contresens géographique — « Saintonge » pour un événement
  // à Pons, le 25/09/2026. Elle doit donc venir des données, d'une zone que les données
  // justifient, ou de la liste des rubriques thématiques. Rien d'autre.
  if (rub && rubriquesAutorisees) {
    const permises = rubriquesAutorisees.map(fold).filter(Boolean);
    if (!permises.includes(rub) && !src.includes(rub)) {
      problems.push(`rubrique absente des données : « ${d.rubrique} »`);
    }
  }

  // visuel
  const { titre, surlignage } = d.visuel;
  if (graphemes(titre) > limits.visualTitle) problems.push(`titre du visuel trop long (${limits.visualTitle} max)`);
  if (!surlignage || !titre.includes(surlignage)) problems.push('le surlignage doit être copié exactement depuis le titre du visuel');
  const hl = tokens(surlignage);
  if (hl.length > 3 || graphemes(surlignage) > limits.highlight) problems.push(`surlignage trop long (3 mots et ${limits.highlight} caractères max)`);
  // Un chiffre suivi de son unité est le meilleur surlignage qui soit (« 500 ans », « 2 500 animaux ») :
  // le mot qui le suit ne compte pas comme petit mot, même s'il figure dans la liste (an, ans, fois…).
  const chiffreEnTete = hl.length > 1 && /^\d/.test(hl[0]);
  if (hl.length && (stop.has(fold(hl[0])) || (!chiffreEnTete && stop.has(fold(hl.at(-1)))))) {
    problems.push(`surlignage « ${surlignage} » : ne doit ni commencer ni finir par un petit mot`);
  }
  if (hl.length === 1 && graphemes(hl[0]) < 3 && !/\d/.test(hl[0])) problems.push(`surlignage « ${surlignage} » trop faible`);
  if (graphemes(d.visuel.texte_alternatif) > limits.altText) problems.push('texte alternatif trop long');
  if (!d.visuel.description?.trim()) problems.push('texte de la 2ᵉ image vide');
  if (graphemes(d.visuel.description) > limits.slideText) problems.push(`texte de la 2ᵉ image : ${graphemes(d.visuel.description)} caractères (${limits.slideText} max)`);
  if (EMOJI.test(d.visuel.description) || d.visuel.description.includes('#')) problems.push('texte de la 2ᵉ image : ni emoji ni hashtag');
  if (!d.threads.sujet || graphemes(d.threads.sujet) > limits.threadsTopic || /[.&#]/.test(d.threads.sujet)) problems.push(`sujet Threads invalide : « ${d.threads.sujet} »`);

  // textes
  const texts = { instagram: d.instagram.texte, facebook: d.facebook.texte, bluesky: d.bluesky.texte, threads: d.threads.texte, x: d.x.texte };
  const max = { instagram: limits.instagramText, facebook: limits.facebook, bluesky: limits.bluesky, threads: limits.threads, x: limits.x };
  for (const [net, text] of Object.entries(texts)) {
    if (!text?.trim()) problems.push(`${net} : texte vide`);
    if (graphemes(text) > max[net]) problems.push(`${net} : ${graphemes(text)} caractères (${max[net]} max)`);
    if (/https?:\/\/|www\./i.test(text)) problems.push(`${net} : pas de lien dans le texte`);
    // Facebook : le texte est lu d'un bloc, au-dessus de la carte d'aperçu. Un retour à la ligne
    // pousse la suite derrière « Voir plus » (environ 125 caractères visibles sur mobile).
    if (net === 'facebook' && /[\r\n]/.test(text)) problems.push('facebook : une seule phrase, sans retour à la ligne');
    // emojis : au moins 1, plafond par réseau ; sujet sensible : un seul, sobre ; pas les mêmes que les derniers posts
    const found = extractEmojis(text);
    const [emin, emax] = [].concat(limits.emoji?.[net] ?? [0, 0]).concat(limits.emoji?.[net] ?? 0).slice(0, 2);
    if (found.length < emin) problems.push(`${net} : au moins ${emin} emoji (choisi selon le sujet)`);
    if (found.length > (d.sensible ? 1 : emax)) problems.push(`${net} : ${found.length} emojis, ${d.sensible ? 1 : emax} max`);
    const sober = sensitiveEmojis.map(bareEmoji);
    if (d.sensible && found.some((e) => !sober.includes(e))) problems.push(`${net} : sujet sensible, emoji sobre uniquement (${sensitiveEmojis.join(' ')})`);
    // placement imposé : en tête ou non (les autres positions sont laissées au jugement du rédacteur)
    const placement = emojiPlacement[net];
    const startsWithEmoji = /^\s*\p{Extended_Pictographic}/u.test(text);
    if (placement === 'en tête du texte' && !startsWithEmoji) problems.push(`${net} : emoji attendu en tête du texte`);
    if (placement && placement !== 'en tête du texte' && startsWithEmoji) problems.push(`${net} : emoji pas en tête pour ce post (${placement})`);
    const recent = new Set((recentEmojis[net] ?? []).flat());
    if (!d.sensible && found.length && found.every((e) => recent.has(e))) problems.push(`${net} : emoji(s) ${found.join('')} déjà utilisés dans les derniers posts`);
    if (/#[\p{L}\p{N}]/u.test(text)) problems.push(`${net} : pas de hashtag dans le texte`);
    if (questions[net] === false && /\?/.test(text)) problems.push(`${net} : pas de question pour ce post (questions limitées)`);
    const bait = baitPatterns.find((p) => fold(text).includes(fold(p)));
    if (bait) problems.push(`${net} : formule d'appel à l'engagement interdite (« ${bait} »)`);
    if (/[.…]\s*\p{Extended_Pictographic}/u.test(text)) problems.push(`${net} : pas de point juste avant un emoji`);
  }
  if (graphemes(d.instagram.texte.split('\n')[0]) > limits.instagramFirstLine) problems.push(`instagram : première ligne > ${limits.instagramFirstLine} caractères`);

  // hashtags
  const tags = d.instagram.hashtags;
  if (tags.length !== 3) problems.push('instagram : exactement 3 hashtags');
  if (new Set(tags.map(fold)).size !== tags.length) problems.push('instagram : hashtags en double');
  for (const tag of [...tags, d.bluesky.hashtag]) {
    if (!HASHTAG.test(tag)) problems.push(`hashtag invalide : « ${tag} »`);
    if (bannedHashtags.map(fold).includes(fold(tag))) problems.push(`hashtag interdit : « ${tag} »`);
  }

  // anti-invention : chiffres et noms propres présents dans les données
  const produced = [titre, d.visuel.description, d.visuel.texte_alternatif, ...Object.values(texts)];
  for (const n of new Set(produced.flatMap(numbers))) if (!srcNumbers.has(n)) problems.push(`chiffre absent des données : ${n}`);
  const allowed = [...knownNames, d.rubrique].map(fold);
  for (const name of new Set(produced.flatMap(properNames))) {
    const f = fold(name);
    if (!src.includes(f) && !allowed.some((k) => k.includes(f))) problems.push(`nom propre absent des données : ${name}`);
  }

  // diversité : tournures reprises entre réseaux ou depuis les accroches récentes
  const nets = Object.keys(texts);
  for (let i = 0; i < nets.length; i++) {
    for (let j = i + 1; j < nets.length; j++) {
      if (similarity(texts[nets[i]], texts[nets[j]]) > similarityMax) problems.push(`${nets[i]} et ${nets[j]} reprennent les mêmes tournures`);
    }
    for (const past of memory[nets[i]] ?? []) {
      if (similarity(texts[nets[i]].slice(0, 160), past) > memorySimilarityMax) problems.push(`${nets[i]} : trop proche d'une accroche récente`);
    }
  }
  return [...new Set(problems)];
}
