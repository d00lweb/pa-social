import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDueAt, recheck, creneauDe, dayKey } from '../src/core/scheduler.mjs';
import { config } from '../src/core/config.mjs';

// Facebook : un post le matin, un en fin de journée, jamais deux dans le même créneau, et toujours
// à un passage réel du robot (:00 et :20) — un instant tiré entre deux passages sortirait du créneau.

const TZ = 'Europe/Paris';
const fb = config.channels.facebook;
const at = (s) => Date.parse(s);
const paris = (ms) => new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
// En septembre, Paris est à UTC+2

test('Facebook : deux créneaux, le matin et en fin de journée, deux posts par jour au plus', () => {
  assert.deepEqual(fb.creneaux, [['08:00', '09:30'], ['20:00', '21:30']]);
  assert.equal(fb.maxPerDay, 2);
});

test('un article de la nuit part au créneau du matin, à un passage réel tiré au hasard', () => {
  const now = at('2026-09-18T04:00:00Z'); // 6 h
  const heures = new Set([0, 0.3, 0.6, 0.99].map((r) => paris(planDueAt({ now, channel: fb, timeZone: TZ, rng: () => r }))));
  assert.deepEqual([...heures].sort(), ['08:00', '08:20', '09:00', '09:20']);
});

test('le créneau du matin pris, le suivant part le soir', () => {
  const now = at('2026-09-18T05:00:00Z'); // 7 h
  const matin = planDueAt({ now, channel: fb, timeZone: TZ, rng: () => 0 });
  const soir = planDueAt({ now, lastPlannedAt: matin, channel: fb, timeZone: TZ, rng: () => 0 });
  assert.equal(paris(matin), '08:00');
  assert.equal(paris(soir), '20:00');
});

test('les deux créneaux pris, le troisième part le lendemain matin', () => {
  const now = at('2026-09-18T05:00:00Z');
  const soir = at('2026-09-18T18:20:00Z'); // 20 h 20
  const suivant = planDueAt({ now, lastPlannedAt: soir, channel: fb, timeZone: TZ, rng: () => 0 });
  assert.equal(paris(suivant), '08:00');
  assert.notEqual(dayKey(suivant, TZ), dayKey(soir, TZ), 'le lendemain');
});

test('trop tard pour le matin : le soir du même jour', () => {
  const now = at('2026-09-18T07:25:00Z'); // 9 h 25, plus aucun passage dans le créneau
  const due = planDueAt({ now, channel: fb, timeZone: TZ, rng: () => 0 });
  assert.equal(paris(due), '20:00');
  assert.equal(dayKey(due, TZ), dayKey(now, TZ));
});

test('au moment de publier : autorisé dans un créneau libre', () => {
  const now = at('2026-09-18T18:03:00Z'); // 20 h 03
  assert.equal(recheck({ now, lastAt: at('2026-09-18T06:05:00Z'), channel: fb, timeZone: TZ }), null);
});

test('au moment de publier : jamais deux posts dans le même créneau', () => {
  const now = at('2026-09-18T06:23:00Z'); // 8 h 23, un post est déjà parti à 8 h 03
  const report = recheck({ now, lastAt: at('2026-09-18T06:03:00Z'), channel: fb, timeZone: TZ, rng: () => 0 });
  assert.ok(report, 'reporté');
  assert.equal(paris(report), '20:00');
});

test('au moment de publier : hors créneau, reporté au suivant', () => {
  const now = at('2026-09-18T11:05:00Z'); // 13 h 05
  const report = recheck({ now, channel: fb, timeZone: TZ, rng: () => 0 });
  assert.equal(paris(report), '20:00');
});

test('la tolérance couvre un passage lent, pas le passage suivant', () => {
  assert.equal(creneauDe(at('2026-09-18T07:40:00Z'), fb.creneaux, TZ, 0.25), 0, '9 h 40 : le passage de 9 h 20 a tardé');
  assert.equal(creneauDe(at('2026-09-18T08:00:00Z'), fb.creneaux, TZ, 0.25), -1, '10 h : hors créneau');
});

// ── Tous les réseaux ──
const reseaux = config.channels;
const h = (s) => { const [a, b] = s.split(':').map(Number); return a + b / 60; };

test('chaque réseau a ses créneaux : un par post autorisé, hors nuit, assez espacés', () => {
  for (const [nom, c] of Object.entries(reseaux)) {
    assert.ok(Array.isArray(c.creneaux) && c.creneaux.length, `${nom} : créneaux définis`);
    assert.equal(c.creneaux.length, c.maxPerDay, `${nom} : un créneau par post autorisé`);
    for (const [debut, fin] of c.creneaux) {
      assert.ok(h(debut) >= c.quietHours.end && h(fin) <= c.quietHours.start, `${nom} : ${debut} – ${fin} hors heures creuses`);
    }
    // deux créneaux voisins ne forcent jamais deux posts plus proches que l'écart minimum
    for (let i = 1; i < c.creneaux.length; i++) {
      assert.ok(h(c.creneaux[i][0]) - h(c.creneaux[i - 1][1]) >= c.ecartMinHeures, `${nom} : ${c.creneaux[i - 1][1]} → ${c.creneaux[i][0]}`);
    }
  }
});

test('Threads et X : aucun créneau le soir, qui y sous-performe (Buffer 2026)', () => {
  for (const nom of ['threads', 'x']) for (const [, fin] of reseaux[nom].creneaux) assert.ok(h(fin) <= 18, `${nom} : ${fin}`);
});

test('les réseaux s’étalent sur la journée au lieu de publier tous à la même heure', () => {
  const premiers = new Set(Object.values(reseaux).map((c) => c.creneaux[0][0]));
  assert.ok(premiers.size >= 4, 'des premiers créneaux différents d’un réseau à l’autre');
});

const ig = reseaux.instagram;

test('un article ordinaire attend le créneau de son réseau', () => {
  const now = at('2026-09-18T13:05:00Z'); // 15 h 05
  assert.equal(paris(planDueAt({ now, channel: ig, timeZone: TZ, nature: 'evergreen', rng: () => 0 })), '18:00');
  const threads = planDueAt({ now, channel: reseaux.threads, timeZone: TZ, nature: 'actu', rng: () => 0 });
  assert.equal(paris(threads), '07:00', 'plus de créneau Threads aujourd’hui : demain matin');
});

test('actualité chaude : part au passage suivant, sans attendre le créneau', () => {
  const now = at('2026-09-18T13:05:00Z'); // 15 h 05
  assert.equal(paris(planDueAt({ now, channel: ig, timeZone: TZ, nature: 'actu_chaude' })), '15:20');
});

test('actualité chaude : jamais la nuit', () => {
  const now = at('2026-09-18T21:30:00Z'); // 23 h 30
  assert.equal(paris(planDueAt({ now, channel: ig, timeZone: TZ, nature: 'actu_chaude' })), '07:00');
});

test('actualité chaude : l’écart minimum avec le post précédent est tenu', () => {
  const now = at('2026-09-18T13:05:00Z'); // 15 h 05, un post est parti à 15 h
  const due = planDueAt({ now, lastAt: at('2026-09-18T13:00:00Z'), channel: ig, timeZone: TZ, nature: 'actu_chaude' });
  assert.equal(paris(due), '17:00', '15 h + 2 h d’écart');
});

test('actualité chaude : elle ne se range pas derrière un post prévu plus tard', () => {
  const now = at('2026-09-18T13:05:00Z');
  const due = planDueAt({ now, lastPlannedAt: at('2026-09-18T16:00:00Z'), channel: ig, timeZone: TZ, nature: 'actu_chaude' });
  assert.equal(paris(due), '15:20');
});

test('au moment de publier, un post de créneau cède devant l’écart minimum', () => {
  // une actualité chaude est partie à 11 h 55 : le post du créneau de midi glisse au soir
  const now = at('2026-09-18T10:03:00Z'); // 12 h 03
  const report = recheck({ now, lastAt: at('2026-09-18T09:55:00Z'), channel: ig, timeZone: TZ, rng: () => 0 });
  assert.equal(paris(report), '18:00');
});

test('au moment de publier, une actualité chaude passe hors créneau', () => {
  const now = at('2026-09-18T13:23:00Z'); // 15 h 23, hors de tout créneau Instagram
  assert.equal(recheck({ now, channel: ig, timeZone: TZ, nature: 'actu_chaude' }), null);
});

test('changement d’heure d’octobre : le créneau reste à l’heure de Paris', () => {
  const now = at('2026-10-26T04:00:00Z'); // lundi 26/10, Paris à UTC+1 : 5 h
  const due = planDueAt({ now, channel: fb, timeZone: TZ, rng: () => 0 });
  assert.equal(paris(due), '08:00');
  assert.equal(new Date(due).toISOString(), '2026-10-26T07:00:00.000Z');
});
