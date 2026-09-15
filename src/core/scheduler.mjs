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

const pick = ([min, max], rng) => min + rng() * (max - min);
export const jitter = (range, rng = Math.random) => pick(range, rng) * MINUTE;
// gapHours : nombre fixe ou intervalle [min, max] tiré au hasard à chaque publication
const range = (v) => (Array.isArray(v) ? v : [v, v]);
export const minGapMs = (channel) => range(channel.gapHours)[0] * HOUR;

// Heure prévue : écart variable après la dernière publication (ou prévision), hors nuit, décalage aléatoire
export function planDueAt({ now, lastAt = 0, lastPlannedAt = 0, channel, timeZone, rng = Math.random }) {
  const base = Math.max(lastAt, lastPlannedAt);
  let due = Math.max(now, base ? base + pick(range(channel.gapHours), rng) * HOUR : 0) + jitter(channel.jitterMinutes, rng);
  if (isQuiet(due, channel.quietHours, timeZone)) {
    due = nextOpen(due, channel.quietHours, timeZone) + jitter(channel.morningJitterMinutes ?? channel.jitterMinutes, rng);
  }
  return Math.round(due);
}

// Au moment de publier : null si c'est possible, sinon la nouvelle heure prévue
export function recheck({ now, lastAt = 0, channel, timeZone, rng = Math.random }) {
  if (lastAt && now < lastAt + minGapMs(channel)) return planDueAt({ now, lastAt, channel, timeZone, rng });
  if (isQuiet(now, channel.quietHours, timeZone)) return planDueAt({ now, channel, timeZone, rng });
  return null;
}
