// Planification pure (sans E/S) : créneaux par réseau, heures creuses, écart minimum, décalage aléatoire
const MINUTE = 60e3;
const HOUR = 60 * MINUTE;

export function localHour(ms, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return get('hour') + get('minute') / 60;
}

export function isQuiet(ms, quiet, timeZone) {
  if (!quiet) return false;
  const h = localHour(ms, timeZone);
  return quiet.start > quiet.end ? h >= quiet.start || h < quiet.end : h >= quiet.start && h < quiet.end;
}

// Premier instant hors heures creuses, par pas de 5 min (changements d'heure compris)
export function nextOpen(ms, quiet, timeZone) {
  let t = ms;
  for (let i = 0; i < 24 * 12 && isQuiet(t, quiet, timeZone); i++) t += 5 * MINUTE;
  return t;
}

// Jour civil local (aaaa-mm-jj) : sert à compter les publications de la journée
export const dayKey = (ms, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

// Publications déjà faites aujourd'hui sur un réseau
export const countToday = (history, channelId, now, timeZone) =>
  history.filter((e) => e.channel === channelId && dayKey(new Date(e.at).getTime(), timeZone) === dayKey(now, timeZone)).length;

// Premier créneau ouvert du lendemain : ce qui dépasse le plafond du jour attend là
export function nextDay(ms, quiet, timeZone) {
  const jour = dayKey(ms, timeZone);
  let t = ms;
  for (let i = 0; i < 48 && dayKey(t, timeZone) === jour; i++) t += HOUR;
  return nextOpen(t, quiet, timeZone);
}

const pick = ([min, max], rng) => min + rng() * (max - min);
export const jitter = (range, rng = Math.random) => pick(range, rng) * MINUTE;
// gapHours : nombre fixe ou intervalle [min, max] tiré au hasard à chaque publication
const range = (v) => (Array.isArray(v) ? v : [v, v]);
export const minGapMs = (channel) => range(channel.gapHours)[0] * HOUR;

// ── Le moteur des meilleurs horaires ──
// Chaque réseau a ses créneaux, choisis d'après les études d'audience (sources dans
// config/channels.json) : un post au plus par créneau, à un passage du robot tiré au hasard parmi
// ceux que le créneau contient. L'heure n'est jamais fixe, et elle est toujours réelle : un instant
// tiré entre deux passages ne partirait qu'au suivant, parfois hors créneau.
// Exception : une actualité chaude part au passage suivant sans attendre de créneau, comme dans une
// rédaction — la fraîcheur prime sur l'horaire. Dans tous les cas : heures creuses respectées, écart
// minimum avec le post précédent du même réseau, plafond du jour vérifié au moment de publier.

// Cadence du robot : le cron o2switch le déclenche à :00 et :20. Le cron GitHub, trop irrégulier
// (2 passages sur 48 demandés, mesuré le 18/09/2026), n'entre pas dans le calcul.
export const PASSAGES = [0, 20];
// Le robot démarre au passage mais n'atteint la publication que quelques minutes plus tard
const TOLERANCE_H = 0.25;
export const URGENT = 'actu_chaude';

const enHeures = (hhmm) => {
  const [h, m = 0] = String(hhmm).split(':').map(Number);
  return h + m / 60;
};

// Index du créneau qui contient l'instant, en heure locale, ou -1
export function creneauDe(ms, creneaux, timeZone, tolerance = 0) {
  const h = localHour(ms, timeZone);
  return creneaux.findIndex(([debut, fin]) => h >= enHeures(debut) && h <= enHeures(fin) + tolerance);
}

const cleCreneau = (ms, creneaux, timeZone, tolerance = 0) => {
  const i = creneauDe(ms, creneaux, timeZone, tolerance);
  return i < 0 ? null : `${dayKey(ms, timeZone)}#${i}`;
};

const ecartMinMs = (channel) => (channel.ecartMinHeures ?? 0) * HOUR;

// Passages du robot à partir de `ms` (inclus), sur 9 jours au plus. Les minutes sont les mêmes
// en heure de Paris et en UTC, le décalage étant d'heures entières, changements d'heure compris.
function* passagesDepuis(ms, passages) {
  const t = new Date(Math.ceil(ms / MINUTE) * MINUTE);
  for (let i = 0; i < 60 * 24 * 9; i++, t.setTime(t.getTime() + MINUTE)) {
    if (passages.includes(t.getUTCMinutes())) yield t.getTime();
  }
}

export function planCreneau({ now, lastAt = 0, lastPlannedAt = 0, channel, timeZone, nature = null, rng = Math.random, passages = PASSAGES }) {
  // Actualité chaude : premier passage hors nuit, à l'écart minimum du dernier post PUBLIÉ.
  // Elle ne se range pas derrière les posts prévus plus tard : c'est eux qui lui céderont la place.
  if (nature === URGENT) {
    const depart = Math.max(now, lastAt ? lastAt + ecartMinMs(channel) : 0);
    for (const t of passagesDepuis(depart, passages)) if (!isQuiet(t, channel.quietHours, timeZone)) return t;
    return Math.round(depart);
  }
  const dernier = Math.max(lastAt, lastPlannedAt);
  // le créneau du dernier post, publié ou prévu, est pris : on passe au suivant
  const pris = dernier ? cleCreneau(dernier, channel.creneaux, timeZone, TOLERANCE_H) : null;
  const depart = Math.max(now, dernier ? dernier + Math.max(ecartMinMs(channel), MINUTE) : 0);
  const candidats = [];
  let retenu = null;
  for (const t of passagesDepuis(depart, passages)) {
    const cle = cleCreneau(t, channel.creneaux, timeZone);
    if (!cle || cle === pris) {
      if (candidats.length) break;
      continue;
    }
    if (retenu && cle !== retenu) break;
    retenu = cle;
    candidats.push(t);
  }
  if (!candidats.length) return Math.round(now);
  return candidats[Math.min(candidats.length - 1, Math.floor(rng() * candidats.length))];
}

// Heure prévue. Réseau à créneaux : le moteur des meilleurs horaires. Réseau sans créneaux (conservé
// pour la compatibilité) : écart variable après le dernier post, hors nuit, décalage aléatoire.
export function planDueAt({ now, lastAt = 0, lastPlannedAt = 0, channel, timeZone, nature = null, rng = Math.random }) {
  if (channel.creneaux) return planCreneau({ now, lastAt, lastPlannedAt, channel, timeZone, nature, rng });
  const base = Math.max(lastAt, lastPlannedAt);
  let due = Math.max(now, base ? base + pick(range(channel.gapHours), rng) * HOUR : 0) + jitter(channel.jitterMinutes, rng);
  if (isQuiet(due, channel.quietHours, timeZone)) {
    due = nextOpen(due, channel.quietHours, timeZone) + jitter(channel.morningJitterMinutes ?? channel.jitterMinutes, rng);
  }
  return Math.round(due);
}

// Au moment de publier : null si c'est possible, sinon la nouvelle heure prévue
export function recheck({ now, lastAt = 0, channel, timeZone, nature = null, rng = Math.random }) {
  if (channel.creneaux) {
    const tropTot = Boolean(lastAt) && now - lastAt < ecartMinMs(channel);
    const replanifier = () => planCreneau({ now, lastAt, channel, timeZone, nature, rng });
    // actualité chaude : dès que la nuit et l'écart minimum le permettent
    if (nature === URGENT) return !tropTot && !isQuiet(now, channel.quietHours, timeZone) ? null : replanifier();
    // sinon : dans un créneau encore libre aujourd'hui, à l'écart minimum du post précédent
    const ici = cleCreneau(now, channel.creneaux, timeZone, TOLERANCE_H);
    const pris = lastAt ? cleCreneau(lastAt, channel.creneaux, timeZone, TOLERANCE_H) : null;
    return ici && ici !== pris && !tropTot ? null : replanifier();
  }
  if (lastAt && now < lastAt + minGapMs(channel)) return planDueAt({ now, lastAt, channel, timeZone, rng });
  if (isQuiet(now, channel.quietHours, timeZone)) return planDueAt({ now, channel, timeZone, rng });
  return null;
}

// ── Minute exacte de départ ──
// Chaque post automatique reçoit, à l'avance, sa minute de départ dans son passage : tirée au hasard
// entre 3 et 15 min après le début du passage, à 3 min au moins de tout autre réseau du même passage.
// Jamais pile à l'heure, jamais deux réseaux ensemble — et l'heure affichée est l'heure réelle.
// Mesuré le 18/09/2026 avant l'étalement : 7 paires de réseaux parties à moins de 2 min d'intervalle
// sur 24 publications, dont Instagram, Bluesky et le kit X à la même minute.
export const FENETRE_DEPART = [3, 15];
export const ECART_DEPARTS = 3;

// pris : minutes déjà attribuées dans ce passage, en ms depuis son début.
// max : dernière minute permise, pour ne jamais dépasser la fin du créneau affiché.
// Le tirage se fait dans les intervalles réellement libres : s'il reste une place, elle est trouvée.
export function tirerMinute(pris = [], rng = Math.random, max = FENETRE_DEPART[1] * MINUTE) {
  const debut = FENETRE_DEPART[0] * MINUTE;
  const fin = Math.max(debut, Math.min(max, FENETRE_DEPART[1] * MINUTE));
  const ecart = ECART_DEPARTS * MINUTE;
  let libres = [[debut, fin]];
  for (const p of pris) {
    libres = libres.flatMap(([a, b]) => [[a, Math.min(b, p - ecart)], [Math.max(a, p + ecart), b]]).filter(([a, b]) => b >= a);
  }
  // passage saturé : juste après le plus tardif, la durée d'un passage reste bornée
  if (!libres.length) return Math.max(debut, ...pris) + ecart;
  let reste = rng() * libres.reduce((s, [a, b]) => s + (b - a), 0);
  for (const [a, b] of libres) {
    if (reste <= b - a) return Math.round(a + reste);
    reste -= b - a;
  }
  return libres.at(-1)[1];
}

// Dernière minute de départ permise dans ce passage : jamais au-delà de la fin du créneau affiché
function limiteMinute(channel, passage, nature, timeZone) {
  const max = FENETRE_DEPART[1] * MINUTE;
  if (nature === URGENT || !channel.creneaux) return max;
  const i = creneauDe(passage, channel.creneaux, timeZone);
  if (i < 0) return max;
  const reste = (enHeures(channel.creneaux[i][1]) - localHour(passage, timeZone)) * HOUR;
  return Math.max(FENETRE_DEPART[0] * MINUTE, Math.min(max, Math.round(reste)));
}

// Début du passage du robot qui contient l'instant
export function passageDe(ms, passages = PASSAGES) {
  const t = Math.floor(ms / MINUTE) * MINUTE;
  for (let i = 0; i < 60; i++) if (passages.includes(new Date(t - i * MINUTE).getUTCMinutes())) return t - i * MINUTE;
  return t;
}

// ── La file, toujours vraie ──
// À chaque passage, le robot revalide TOUTE la file selon les règles en vigueur, pas seulement les posts
// arrivés à échéance. Une heure devenue fausse (règles changées, créneau terminé ou occupé, plafond du
// jour atteint, post trop proche du précédent) est recalculée aussitôt, raison notée ; une heure juste
// ne bouge plus. Chaque post reçoit en même temps sa minute exacte. La file dit donc toujours la vérité,
// et la page de pilotage l'affiche telle quelle, sans rien deviner. Avant, l'heure n'était recalculée
// qu'à l'échéance et la page devait la deviner : d'où les « reporté » et « en retard » affichés à tort.
const MARGE_SANS_MINUTE = 20 * MINUTE; // tant que la minute n'est pas tirée, on compte large

function motifInvalide({ q, passage, nature, channel, courant, dernier, parJour, creneauxPris, timeZone }) {
  if (passage < courant) return 'son créneau était passé';
  if (nature === URGENT) {
    if (isQuiet(q.dueAt, channel.quietHours, timeZone)) return 'l’heure tombait dans les heures creuses';
  } else {
    const cle = cleCreneau(passage, channel.creneaux, timeZone);
    if (!cle) return 'l’heure n’était pas dans les créneaux du réseau';
    if (creneauxPris.has(cle)) return 'un autre post occupait déjà ce créneau';
  }
  if ((parJour.get(dayKey(q.dueAt, timeZone)) ?? 0) >= channel.maxPerDay) return 'le nombre de posts du jour était atteint';
  if (dernier && q.dueAt - dernier < ecartMinMs(channel)) return 'trop proche du post précédent';
  return null;
}

// items : posts en attente, modifiés sur place (dueAt, et au besoin prevuInitialement et raison).
// canaux : { id: configuration } des réseaux actifs et non en pause. Rend la liste des recalculs.
export function ordonnerFile({ items, historique = [], canaux, now, timeZone, rng = Math.random, passages = PASSAGES }) {
  const courant = passageDe(now, passages);
  const minutesPrises = new Map();
  const prendre = (ms) => {
    const p = passageDe(ms, passages);
    minutesPrises.set(p, [...(minutesPrises.get(p) ?? []), ms - p]);
  };
  const aTirer = [];
  const changements = [];

  for (const [id, channel] of Object.entries(canaux)) {
    if (!channel.creneaux) continue;
    const file = items.filter((q) => q.channel === id).sort((a, b) => a.dueAt - b.dueAt);
    if (!file.length) continue;
    const parJour = new Map();
    const creneauxPris = new Set();
    const occuper = (ms) => {
      const jour = dayKey(ms, timeZone);
      parJour.set(jour, (parJour.get(jour) ?? 0) + 1);
      const cle = cleCreneau(ms, channel.creneaux, timeZone, TOLERANCE_H);
      if (cle) creneauxPris.add(cle);
    };
    const publies = historique.filter((e) => e.channel === id && e.at).map((e) => Date.parse(e.at)).sort((a, b) => a - b);
    publies.forEach(occuper);
    let dernier = publies.at(-1) ?? 0;

    for (const q of file) {
      const nature = q.dossier?.nature ?? null;
      const passage = passageDe(q.dueAt, passages);
      const motif = motifInvalide({ q, passage, nature, channel, courant, dernier, parJour, creneauxPris, timeZone });
      if (!motif) {
        occuper(passage);
        const minute = q.dueAt - passage;
        if (channel.manual) {
          // le kit X part au passage : rien à attendre, c'est l'équipe qui publie
          q.dueAt = passage;
          dernier = passage;
        } else if (minute < FENETRE_DEPART[0] * MINUTE || minute > limiteMinute(channel, passage, nature, timeZone)) {
          // pas encore de minute exacte, ou une minute venue d'ailleurs (ancienne file, nouvel essai) qui
          // sortirait du créneau affiché ou ferait attendre le robot trop longtemps : on la tire
          aTirer.push({ q, passage, max: limiteMinute(channel, passage, nature, timeZone) });
          dernier = passage + MARGE_SANS_MINUTE;
        } else {
          prendre(q.dueAt);
          dernier = q.dueAt;
        }
        continue;
      }
      // prochaine heure valable, plafond du jour compris
      let p = planDueAt({ now, lastAt: dernier, channel, timeZone, nature, rng });
      for (let k = 0; k < 8 && (parJour.get(dayKey(p, timeZone)) ?? 0) >= channel.maxPerDay; k++) {
        p = planDueAt({ now: nextDay(p, channel.quietHours, timeZone), lastAt: dernier, channel, timeZone, nature, rng });
      }
      // un post planifié à ce passage même n'a pas d'« heure initiale » à montrer
      if (!q.nouveau) {
        q.prevuInitialement ??= q.dueAt;
        q.raison = motif;
      }
      changements.push({ q, channel: id, titre: q.article?.title ?? '', avant: q.dueAt, raison: motif });
      q.dueAt = p;
      occuper(p);
      const nouveauPassage = passageDe(p, passages);
      if (!channel.manual) aTirer.push({ q, passage: nouveauPassage, max: limiteMinute(channel, nouveauPassage, nature, timeZone) });
      dernier = channel.manual ? p : nouveauPassage + MARGE_SANS_MINUTE;
    }
  }

  // minutes exactes, tirées une fois pour toutes, jamais à moins de 3 min d'un autre réseau ; dans un
  // même passage, le réseau dont le créneau se termine le plus tôt tire en premier, pour garder sa place
  for (const { q, passage, max } of aTirer.sort((a, b) => a.passage - b.passage || a.max - b.max)) {
    q.dueAt = passage + tirerMinute(minutesPrises.get(passage) ?? [], rng, max);
    prendre(q.dueAt);
  }
  for (const q of items) delete q.nouveau;
  return changements.map(({ q, ...c }) => ({ ...c, apres: q.dueAt }));
}
