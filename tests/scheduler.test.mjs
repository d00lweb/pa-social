import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isQuiet, planDueAt, recheck } from '../src/core/scheduler.mjs';

const TZ = 'Europe/Paris';
const channel = { gapHours: 3, quietHours: { start: 23, end: 7 }, jitterMinutes: [5, 35] };
const at = (iso) => Date.parse(iso);
const MIN = 60e3;
const H = 3600e3;

test('heures creuses 23 h – 7 h (heure de Paris)', () => {
  assert.equal(isQuiet(at('2026-09-15T21:30:00Z'), channel.quietHours, TZ), true); // 23h30
  assert.equal(isQuiet(at('2026-09-15T04:59:00Z'), channel.quietHours, TZ), true); // 6h59
  assert.equal(isQuiet(at('2026-09-15T05:00:00Z'), channel.quietHours, TZ), false); // 7h00
  assert.equal(isQuiet(at('2026-12-15T06:30:00Z'), channel.quietHours, TZ), false); // 7h30 en hiver
});

test('décalage aléatoire borné à 5–35 min', () => {
  const now = at('2026-09-15T08:00:00Z');
  assert.equal(planDueAt({ now, channel, timeZone: TZ, rng: () => 0 }), now + 5 * MIN);
  assert.equal(planDueAt({ now, channel, timeZone: TZ, rng: () => 1 }), now + 35 * MIN);
});

test('deux articles à 7h00 et 7h15 : le second 3 h après le premier', () => {
  const rng = () => 0;
  const first = planDueAt({ now: at('2026-09-15T05:00:00Z'), channel, timeZone: TZ, rng });
  const second = planDueAt({ now: at('2026-09-15T05:15:00Z'), lastPlannedAt: first, channel, timeZone: TZ, rng });
  assert.equal(second - first, 3 * H + 5 * MIN);
});

test('un article de la nuit part au matin', () => {
  const due = planDueAt({ now: at('2026-09-15T22:00:00Z'), channel, timeZone: TZ, rng: () => 0 }); // minuit
  assert.equal(due, at('2026-09-16T05:05:00Z')); // 7h05
});

test('écart variable et reprise du matin variable', () => {
  const varied = { ...channel, gapHours: [3, 4.5], jitterMinutes: [0, 0], morningJitterMinutes: [10, 95] };
  const now = at('2026-09-15T08:00:00Z');
  const last = at('2026-09-15T07:00:00Z');
  assert.equal(planDueAt({ now, lastAt: last, channel: varied, timeZone: TZ, rng: () => 0 }), last + 3 * H);
  assert.equal(planDueAt({ now, lastAt: last, channel: varied, timeZone: TZ, rng: () => 1 }), last + 4.5 * H);
  assert.equal(planDueAt({ now: at('2026-09-15T22:00:00Z'), channel: varied, timeZone: TZ, rng: () => 1 }), at('2026-09-16T06:35:00Z')); // 8h35
  assert.equal(recheck({ now: last + 3.2 * H, lastAt: last, channel: varied, timeZone: TZ }), null);
});

test('vérification au moment de publier', () => {
  const now = at('2026-09-15T10:00:00Z');
  assert.ok(recheck({ now, lastAt: now - 1 * H, channel, timeZone: TZ, rng: () => 0 }) > now);
  assert.equal(recheck({ now, lastAt: now - 4 * H, channel, timeZone: TZ }), null);
  assert.ok(recheck({ now: at('2026-09-15T23:00:00Z'), channel, timeZone: TZ, rng: () => 0 }) >= at('2026-09-16T05:00:00Z'));
});
