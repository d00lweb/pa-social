import { pickHighlight } from './editorial.mjs';
import { HASHTAG } from './guards.mjs';

// Réparation des défauts mécaniques d'un dossier refusé par les contrôles.
//
// Jeter cinq textes bien écrits parce qu'un mot surligné dépasse de deux caractères, ou qu'un
// emoji n'est pas à la place demandée, coûte un appel de plus (5 centimes) pour un texte qui ne
// sera pas meilleur. On corrige donc la forme soi-même, à trois conditions :
//   - aucun mot ni chiffre ne change : on ne déplace, n'ajoute ou ne remplace que des emojis,
//     des points et des « # » (vérifié texte par texte, sinon la réparation est abandonnée) ;
//   - aucun emoji n'est inventé : celui qu'on pose vient d'un autre réseau du même dossier,
//     choisi par le rédacteur pour cet article (sujet sensible : la liste sobre) ;
//   - le dossier réparé repasse TOUS les contrôles (buildDossier) : s'il en rate un seul, on
//     redemande à l'IA comme avant.
// Invention, répétition, appât, longueur, question interdite : jamais réparés ici.

const RESEAUX = ['instagram', 'facebook', 'bluesky', 'threads', 'x'];
// Où chercher un emoji pour un autre réseau : Instagram en porte jusqu'à trois, choisis sur le sujet
const ORDRE_EMOJIS = ['instagram', 'threads', 'x', 'bluesky', 'facebook'];
const EN_TETE = 'en tête du texte';
const EN_FIN = 'en fin de texte';
const MOTIFS_EMOJI = ['emoji (choisi selon le sujet)', 'emoji attendu en tête du texte', 'emoji pas en tête pour ce post', 'déjà utilisés dans les derniers posts'];
// Abréviations dont le point ne ferme pas la phrase : on n'y pose jamais d'emoji
const ABREVIATIONS = new Set(['etc', 'av', 'apr', 'env', 'hab', 'cf', 'ex']);

const segmenteur = new Intl.Segmenter('fr', { granularity: 'grapheme' });
const estEmoji = (s) => /\p{Extended_Pictographic}/u.test(s);
const nu = (e) => e.replace(/️/g, '');
// Lettres et chiffres d'un texte : ce qu'une réparation n'a pas le droit de changer
const mots = (s) => (String(s).toLowerCase().match(/[\p{L}\p{N}]/gu) ?? []).join('');

// Emojis d'un texte, un par graphème (« 🏟️ » = pictogramme + sélecteur de variante), avec leur place
function emojisDe(texte) {
  return [...segmenteur.segment(String(texte))].filter((g) => estEmoji(g.segment)).map((g) => ({ e: g.segment, debut: g.index, fin: g.index + g.segment.length }));
}

// Ce point ferme-t-il une phrase ? Oui pour « centre-ville. », pas pour « av. J.-C. », « 42 °C. »
// ni « 10 000 hab. »
function finDePhrase(texte, i) {
  const avant = texte.slice(0, i);
  if (/[%)»"”]$/u.test(avant)) return true;
  const mot = avant.match(/[\p{L}\p{N}.-]+$/u)?.[0] ?? '';
  if (mot.includes('.')) return false;
  const fin = mot.split('-').at(-1);
  return /^[\p{L}\p{N}]{2,}$/u.test(fin) && !ABREVIATIONS.has(fin.toLowerCase());
}

// L'emoji referme le texte, à la place du point final (jamais de point devant un emoji)
function poserEnFin(texte, e) {
  const t = texte.trimEnd();
  if (t.endsWith('…')) return null;
  if (t.endsWith('.')) return finDePhrase(t, t.length - 1) ? `${t.slice(0, -1)} ${e}` : null;
  return `${t} ${e}`;
}

// L'emoji clôt la première phrase, comme le rédacteur le fait quand il ne l'ouvre ni ne le ferme
// (« 90 % des joueurs formés à la maison 🏟️ C’est… ») ; sans fin de phrase sûre, il ferme le texte.
function poserApresPremierePhrase(texte, e) {
  for (const m of texte.matchAll(/[.!?…](?=\s)|\n/gu)) {
    const i = m.index;
    if (m[0] === '…') break;
    if (m[0] === '\n') return `${texte.slice(0, i).trimEnd()} ${e}${texte.slice(i)}`;
    if (m[0] !== '.') return `${texte.slice(0, i + 1)} ${e}${texte.slice(i + 1)}`;
    const suite = texte.slice(i + 1).trimStart();
    if (finDePhrase(texte, i) && /^[\p{Lu}\p{N}«"“(]/u.test(suite)) return `${texte.slice(0, i)} ${e}${texte.slice(i + 1)}`;
  }
  return poserEnFin(texte, e);
}

function poser(texte, e, placement) {
  if (placement === EN_TETE) return `${e} ${texte.trimStart()}`;
  if (placement === EN_FIN) return poserEnFin(texte, e);
  return poserApresPremierePhrase(texte, e);
}

// Emoji(s) d'ouverture retirés ; le texte repart sur sa majuscule
function retirerEnTete(texte) {
  const pris = [];
  let reste = null;
  for (const g of segmenteur.segment(texte)) {
    if (estEmoji(g.segment)) pris.push(g.segment);
    else if (g.segment.trim()) {
      reste = texte.slice(g.index);
      break;
    }
  }
  if (!pris.length || !reste) return null;
  return { emoji: pris.join(''), reste: reste.replace(/^\p{Ll}/u, (c) => c.toUpperCase()) };
}

// Emoji de clôture retiré ; la phrase retrouve son point
function retirerEnFin(texte) {
  const t = texte.trimEnd();
  const dernier = [...segmenteur.segment(t)].at(-1);
  if (!dernier || !estEmoji(dernier.segment)) return null;
  const reste = t.slice(0, dernier.index).trimEnd();
  if (!reste) return null;
  return { emoji: dernier.segment, reste: /[\p{L}\p{N}]$/u.test(reste) ? `${reste}.` : reste };
}

// Emojis choisis par le rédacteur pour cet article sur les autres réseaux, utilisables sur celui-ci :
// ni déjà dans son texte, ni parmi ses derniers posts, sobres si le sujet est sensible. Un
// pictogramme seul : une séquence composée (👨‍🍳) compterait double dans les contrôles.
function candidats(dossier, net, { recentEmojis = {}, sensitiveEmojis = [] }) {
  const exclus = new Set([...emojisDe(dossier[net].texte).map((x) => nu(x.e)), ...[recentEmojis[net] ?? []].flat(2).map(String).map(nu)]);
  const sobres = new Set(sensitiveEmojis.map(nu));
  const vivier = [...ORDRE_EMOJIS.filter((n) => n !== net).flatMap((n) => emojisDe(dossier[n]?.texte ?? '').map((x) => x.e)), ...(dossier.sensible ? sensitiveEmojis : [])];
  const choix = [];
  for (const e of vivier) {
    const k = nu(e);
    if ([...k].length !== 1 || exclus.has(k) || (dossier.sensible && !sobres.has(k))) continue;
    exclus.add(k);
    choix.push(e);
  }
  return choix;
}

// Emojis d'un réseau : manquant, mal placé ou déjà vu dans les derniers posts. Renvoie le texte
// réparé, ou null si la réparation demanderait de toucher à une phrase.
function reparerEmojis(dossier, net, motifs, { emojiPlacement = {}, recentEmojis = {}, sensitiveEmojis = [], limits = {} }) {
  const placement = emojiPlacement[net];
  const max = dossier.sensible ? 1 : [].concat(limits.emoji?.[net] ?? 1).at(-1);
  const choix = candidats(dossier, net, { recentEmojis, sensitiveEmojis });
  const signale = (motif) => motifs.some((p) => p.includes(motif));
  let t = dossier[net].texte;
  const presents = emojisDe(t);

  // Les mêmes emojis que les derniers posts : le premier est remplacé sur place
  if (signale('déjà utilisés dans les derniers posts')) {
    const e = choix.shift();
    if (!e || !presents.length) return null;
    t = t.slice(0, presents[0].debut) + e + t.slice(presents[0].fin);
  }

  if (signale('emoji (choisi selon le sujet)') && !presents.length) {
    // Aucun emoji : on en pose un, à la place demandée pour ce post
    const e = choix.shift();
    if (!e) return null;
    t = poser(t, e, placement);
  } else if (signale('emoji attendu en tête du texte')) {
    // L'emoji de clôture passe en tête ; à défaut, s'il reste de la place, on en ajoute un.
    // Un emoji en milieu de phrase ne se déplace pas : l'en retirer pourrait casser la phrase.
    const fin = retirerEnFin(t);
    if (fin) t = `${fin.emoji} ${fin.reste}`;
    else if (presents.length < max && choix.length) t = `${choix.shift()} ${t.trimStart()}`;
    else return null;
  }
  if (!t) return null;

  if (signale('emoji pas en tête pour ce post')) {
    // L'emoji d'ouverture va à la place demandée pour ce post
    const tete = retirerEnTete(t);
    if (!tete) return null;
    t = poser(tete.reste, tete.emoji, placement);
  }
  return t;
}

// contexte : emojiPlacement, recentEmojis, sensitiveEmojis, limits — ceux des contrôles
export function reparer(dossier, problems, contexte = {}) {
  const repare = { ...dossier, visuel: { ...dossier.visuel } };
  const faits = [];

  if (problems.some((p) => p.includes('surlignage'))) {
    const { highlight } = pickHighlight(repare.visuel.titre, { avoid: [repare.rubrique] });
    if (highlight && highlight !== repare.visuel.surlignage) {
      repare.visuel.surlignage = highlight;
      faits.push('surlignage');
    }
  }

  if (problems.some((p) => p.includes('point juste avant un emoji'))) {
    for (const net of RESEAUX) {
      const texte = repare[net]?.texte;
      if (!texte) continue;
      const propre = texte.replace(/[.…]\s*(\p{Extended_Pictographic})/gu, ' $1').replace(/ {2,}/g, ' ');
      if (propre !== texte) {
        repare[net] = { ...repare[net], texte: propre };
        faits.push(net);
      }
    }
  }

  for (const net of RESEAUX) {
    const motifs = problems.filter((p) => p.startsWith(`${net} : `) && MOTIFS_EMOJI.some((m) => p.includes(m)));
    if (!motifs.length || !repare[net]?.texte) continue;
    const texte = reparerEmojis(repare, net, motifs, contexte);
    if (texte && texte !== repare[net].texte && mots(texte) === mots(repare[net].texte)) {
      repare[net] = { ...repare[net], texte };
      faits.push(`emoji ${net}`);
    }
  }

  // Hashtag écrit sans son « # » (« Hasparren ») : on le lui rend, rien d'autre
  if (problems.some((p) => p.startsWith('hashtag invalide'))) {
    const diese = (tag) => {
      const avec = `#${String(tag ?? '').trim().replace(/^#+/, '')}`;
      return HASHTAG.test(avec) ? avec : tag;
    };
    const hashtags = (repare.instagram?.hashtags ?? []).map(diese);
    const hashtag = diese(repare.bluesky?.hashtag);
    if (hashtags.some((h, i) => h !== repare.instagram.hashtags[i]) || hashtag !== repare.bluesky?.hashtag) {
      repare.instagram = { ...repare.instagram, hashtags };
      repare.bluesky = { ...repare.bluesky, hashtag };
      faits.push('hashtags');
    }
  }
  return { repare, faits };
}
