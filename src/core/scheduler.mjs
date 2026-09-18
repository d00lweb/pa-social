// Planification pure (sans E/S) : écart variable, heures creuses, reprise du matin variable, décalage aléatoire
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

// ── Créneaux fixes ──
// Facebook : un post le matin, un en fin de journée. Chaque créneau reçoit au plus un post, à un
// passage du robot tiré au hasard parmi ceux qu'il contient : l'heure n'est jamais fixe, et elle est
// toujours réelle — un instant tiré entre deux passages ne partirait qu'au suivant, parfois hors créneau.

// Cadence du robot : le cron o2switch le déclenche à :00 et :20. Le cron GitHub, trop irrégulier
// (2 passages sur 48 demandés, mesuré le 18/09/2026), n'entre pas dans le calcul.
export const PASSAGES = [0, 20];
// Le robot démarre au passage mais n'atteint la publication que quelques minutes plus tard
const TOLERANCE_H = 0.25;

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

// Passages du robot à partir de `ms` (inclus), sur 9 jours au plus. Les minutes sont les mêmes
// en heure de Paris et en UTC, le décalage étant d'heures entières, changements d'heure compris.
function* passagesDepuis(ms, passages) {
  const t = new Date(Math.ceil(ms / MINUTE) * MINUTE);
  for (let i = 0; i < 60 * 24 * 9; i++, t.setTime(t.getTime() + MINUTE)) {
    if (passages.includes(t.getUTCMinutes())) yield t.getTime();
  }
}

export function planCreneau({ now, lastAt = 0, lastPlannedAt = 0, channel, timeZone, rng = Math.random, passages = PASSAGES }) {
  const dernier = Math.max(lastAt, lastPlannedAt);
  // le créneau du dernier post, publié ou prévu, est pris : on passe au suivant
  const pris = dernier ? cleCreneau(dernier, channel.creneaux, timeZone, TOLERANCE_H) : null;
  const candidats = [];
  let retenu = null;
  for (const t of passagesDepuis(Math.max(now, dernier + 1), passages)) {
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

// Heure prévue : écart variable après la dernière publication (ou prévision), hors nuit, décalage aléatoire
export function planDueAt({ now, lastAt = 0, lastPlannedAt = 0, channel, timeZone, rng = Math.random }) {
  if (channel.creneaux) return planCreneau({ now, lastAt, lastPlannedAt, channel, timeZone, rng });
  const base = Math.max(lastAt, lastPlannedAt);
  let due = Math.max(now, base ? base + pick(range(channel.gapHours), rng) * HOUR : 0) + jitter(channel.jitterMinutes, rng);
  if (isQuiet(due, channel.quietHours, timeZone)) {
    due = nextOpen(due, channel.quietHours, timeZone) + jitter(channel.morningJitterMinutes ?? channel.jitterMinutes, rng);
  }
  return Math.round(due);
}

// Au moment de publier : null si c'est possible, sinon la nouvelle heure prévue
export function recheck({ now, lastAt = 0, channel, timeZone, rng = Math.random }) {
  // créneaux : on publie si l'on est dans un créneau encore libre aujourd'hui, sinon au suivant
  if (channel.creneaux) {
    const ici = cleCreneau(now, channel.creneaux, timeZone, TOLERANCE_H);
    const pris = lastAt ? cleCreneau(lastAt, channel.creneaux, timeZone, TOLERANCE_H) : null;
    return ici && ici !== pris ? null : planCreneau({ now, lastAt, channel, timeZone, rng });
  }
  if (lastAt && now < lastAt + minGapMs(channel)) return planDueAt({ now, lastAt, channel, timeZone, rng });
  if (isQuiet(now, channel.quietHours, timeZone)) return planDueAt({ now, channel, timeZone, rng });
  return null;
}
