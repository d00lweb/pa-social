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

// ── Minute de départ dans un passage ──
// Chaque réseau dû à un passage part à une minute tirée au hasard, entre 2 et 14 min après le début
// du passage, et au moins 1 à 3 min (tirées elles aussi) après le réseau précédent : jamais pile à
// l'heure, jamais deux réseaux à la même minute, jamais le même écart entre eux.
// Mesuré le 18/09/2026 avant ce changement, sur 24 publications : 7 paires de réseaux parties à
// moins de 2 min d'intervalle, dont Instagram, Bluesky et le kit X à la même minute, parce qu'une
// réserve d'attente commune de 6 min, vite épuisée, faisait partir les suivants aussitôt.
export const FENETRE_DEPART = [2, 14];
export const ESPACEMENT_RESEAUX = [1, 3];

// precedent : départ réel du réseau précédent dans ce passage, en ms depuis son début (null au premier)
export function tirerDepart(precedent = null, rng = Math.random) {
  const [debut, fin] = FENETRE_DEPART.map((m) => m * MINUTE);
  const plancher = precedent === null ? debut : Math.max(debut, precedent + jitter(ESPACEMENT_RESEAUX, rng));
  // fenêtre épuisée : on part juste après le précédent, la durée du passage reste bornée
  if (plancher >= fin) return Math.round(plancher);
  return Math.round(plancher + rng() * (fin - plancher));
}
