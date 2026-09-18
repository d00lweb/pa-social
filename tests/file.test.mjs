import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ordonnerFile, passageDe, creneauDe, dayKey, FENETRE_DEPART } from '../src/core/scheduler.mjs';
import { config } from '../src/core/config.mjs';

// La file doit toujours dire la vérité : à chaque passage, le robot la revalide en entier et fixe la
// minute exacte de chaque post. Le 18/09/2026, un post Threads prévu à 15:46 selon d'anciennes règles
// s'affichait « 16:00, en retard » alors qu'il ne pouvait partir que le lendemain matin.

const TZ = 'Europe/Paris';
const canaux = config.channels;
const at = (s) => Date.parse(s);
const MIN = 60e3;
const HEURE = 3600e3;
const paris = (ms) => new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
const post = (channel, dueAt, extra = {}) => ({
  channel, dueAt: typeof dueAt === 'number' ? dueAt : at(dueAt), status: 'pending',
  article: { title: `${channel} ${dueAt}` }, dossier: { nature: extra.nature ?? 'evergreen' }, ...extra,
});
const zero = () => 0;
// En septembre, Paris est à UTC+2

test('passage du robot : le dernier :00 ou :20 à l’instant ou avant', () => {
  assert.equal(new Date(passageDe(at('2026-09-18T13:46:00Z'))).toISOString(), '2026-09-18T13:20:00.000Z');
  assert.equal(new Date(passageDe(at('2026-09-18T14:00:00Z'))).toISOString(), '2026-09-18T14:00:00.000Z');
  assert.equal(new Date(passageDe(at('2026-09-18T14:19:59Z'))).toISOString(), '2026-09-18T14:00:00.000Z');
});

test('le cas du 18/09 : le post Threads de 15:46 est recalé au lendemain matin, raison notée', () => {
  const q = post('threads', '2026-09-18T13:46:00Z');
  const changements = ordonnerFile({ items: [q], canaux: { threads: canaux.threads }, now: at('2026-09-18T13:55:00Z'), timeZone: TZ, rng: zero });
  assert.equal(paris(q.dueAt), '07:03');
  assert.equal(dayKey(q.dueAt, TZ), '2026-09-19');
  assert.equal(q.prevuInitialement, at('2026-09-18T13:46:00Z'), 'l’ancienne heure reste visible');
  assert.match(q.raison, /créneaux/);
  assert.equal(changements.length, 1);
});

test('une minute ajoutée n’est pas un recalcul : pas d’heure initiale affichée', () => {
  const q = post('facebook', '2026-09-18T18:00:00Z'); // 20:00, passage exact
  const changements = ordonnerFile({ items: [q], canaux: { facebook: canaux.facebook }, now: at('2026-09-18T14:01:00Z'), timeZone: TZ, rng: zero });
  assert.equal(paris(q.dueAt), '20:03');
  assert.equal(q.prevuInitialement, undefined);
  assert.equal(changements.length, 0);
});

test('un post planifié à ce passage même n’affiche pas d’heure initiale', () => {
  const historique = [{ channel: 'facebook', at: '2026-09-18T06:05:00Z' }, { channel: 'facebook', at: '2026-09-18T11:20:00Z' }];
  const q = post('facebook', '2026-09-18T18:00:00Z', { nouveau: true });
  ordonnerFile({ items: [q], historique, canaux: { facebook: canaux.facebook }, now: at('2026-09-18T14:01:00Z'), timeZone: TZ, rng: zero });
  assert.equal(dayKey(q.dueAt, TZ), '2026-09-19', 'recalé pour le plafond');
  assert.equal(q.prevuInitialement, undefined, 'rien à montrer : il vient d’arriver');
  assert.equal(q.nouveau, undefined, 'la marque est effacée');
});

test('jamais deux posts dans le même créneau : le second glisse au suivant', () => {
  const a = post('facebook', '2026-09-18T18:00:00Z'); // 20:00
  const b = post('facebook', '2026-09-18T18:20:00Z'); // 20:20, même créneau du soir
  ordonnerFile({ items: [a, b], canaux: { facebook: canaux.facebook }, now: at('2026-09-18T14:01:00Z'), timeZone: TZ, rng: zero });
  assert.equal(paris(a.dueAt), '20:03');
  assert.equal(paris(b.dueAt), '08:03');
  assert.equal(dayKey(b.dueAt, TZ), '2026-09-19');
  assert.match(b.raison, /occupait/);
});

test('plafond du jour : deux posts Facebook déjà publiés, le suivant part demain', () => {
  const historique = [{ channel: 'facebook', at: '2026-09-18T06:05:00Z' }, { channel: 'facebook', at: '2026-09-18T11:20:00Z' }];
  const q = post('facebook', '2026-09-18T18:00:00Z');
  ordonnerFile({ items: [q], historique, canaux: { facebook: canaux.facebook }, now: at('2026-09-18T14:01:00Z'), timeZone: TZ, rng: zero });
  assert.equal(paris(q.dueAt), '08:03');
  assert.equal(dayKey(q.dueAt, TZ), '2026-09-19');
  assert.match(q.raison, /nombre de posts du jour/);
});

test('stable : une file déjà en ordre ne bouge plus d’un passage à l’autre', () => {
  const items = [post('facebook', '2026-09-18T18:00:00Z'), post('instagram', '2026-09-18T16:00:00Z'), post('threads', '2026-09-19T05:00:00Z')];
  ordonnerFile({ items, canaux, now: at('2026-09-18T14:01:00Z'), timeZone: TZ });
  const avant = items.map((q) => q.dueAt);
  const changements = ordonnerFile({ items, canaux, now: at('2026-09-18T14:21:00Z'), timeZone: TZ });
  assert.deepEqual(items.map((q) => q.dueAt), avant, 'aucune heure ne change');
  assert.equal(changements.length, 0);
});

test('deux réseaux au même passage ne partent jamais à moins de 3 min d’écart', () => {
  for (let i = 0; i < 300; i++) {
    const ig = post('instagram', '2026-09-18T10:00:00Z'); // 12:00
    const bs = post('bluesky', '2026-09-18T10:00:00Z');
    ordonnerFile({ items: [ig, bs], canaux, now: at('2026-09-18T08:01:00Z'), timeZone: TZ });
    assert.ok(Math.abs(ig.dueAt - bs.dueAt) >= 3 * MIN);
  }
});

test('le kit X part au passage, sans minute d’attente', () => {
  const q = post('x', '2026-09-18T07:00:00Z'); // 9:00
  ordonnerFile({ items: [q], canaux, now: at('2026-09-18T05:01:00Z'), timeZone: TZ });
  assert.equal(paris(q.dueAt), '09:00');
});

test('une actualité chaude garde son heure hors créneau', () => {
  const q = post('instagram', '2026-09-18T13:20:00Z', { nature: 'actu_chaude' }); // 15:20
  ordonnerFile({ items: [q], canaux, now: at('2026-09-18T13:05:00Z'), timeZone: TZ, rng: zero });
  assert.equal(paris(q.dueAt), '15:23');
});

// Générateur reproductible : chaque tour rejoue exactement la même file
const graine = (s) => () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);

test('quelle que soit la file de départ, elle ressort conforme à toutes les règles', () => {
  const ids = ['instagram', 'facebook', 'bluesky', 'threads', 'x'];
  for (let tour = 1; tour <= 200; tour++) {
    const rng = graine(tour);
    const now = at('2026-09-18T04:07:00Z') + Math.floor(rng() * 24) * HEURE;
    const items = Array.from({ length: 2 + Math.floor(rng() * 9) }, () => post(ids[Math.floor(rng() * ids.length)], Math.round(now - 6 * HEURE + rng() * 60 * HEURE)));
    ordonnerFile({ items, canaux, now, timeZone: TZ, rng });
    const courant = passageDe(now);
    const minutesParPassage = new Map();
    for (const id of ids) {
      const c = canaux[id];
      const file = items.filter((q) => q.channel === id).sort((a, b) => a.dueAt - b.dueAt);
      const creneaux = new Set();
      const parJour = new Map();
      file.forEach((q, i) => {
        const quand = `tour ${tour}, ${id}, ${new Date(q.dueAt).toISOString()}`;
        const p = passageDe(q.dueAt);
        assert.ok(p >= courant, `jamais dans le passé (${quand})`);
        const k = creneauDe(p, c.creneaux, TZ);
        assert.ok(k >= 0, `toujours dans un créneau (${quand})`);
        assert.equal(creneauDe(q.dueAt, c.creneaux, TZ), k, `le départ tombe dans le créneau affiché (${quand})`);
        const cle = `${dayKey(p, TZ)}#${k}`;
        assert.ok(!creneaux.has(cle), `un seul post par créneau (${quand})`);
        creneaux.add(cle);
        parJour.set(dayKey(q.dueAt, TZ), (parJour.get(dayKey(q.dueAt, TZ)) ?? 0) + 1);
        if (i) assert.ok(q.dueAt - file[i - 1].dueAt >= c.ecartMinHeures * HEURE, `écart minimum (${quand})`);
        const minute = q.dueAt - p;
        if (c.manual) assert.equal(minute, 0, `kit au passage (${quand})`);
        else {
          assert.ok(minute >= FENETRE_DEPART[0] * MIN, `minute tirée (${quand})`);
          assert.ok(minute <= 20 * MIN, `départ dans son passage, sans attente démesurée (${quand})`);
          minutesParPassage.set(p, [...(minutesParPassage.get(p) ?? []), minute]);
        }
      });
      for (const [jour, n] of parJour) assert.ok(n <= c.maxPerDay, `plafond du jour (tour ${tour}, ${id}, ${jour})`);
    }
    for (const [, minutes] of minutesParPassage) {
      const triees = [...minutes].sort((a, b) => a - b);
      for (let i = 1; i < triees.length; i++) assert.ok(triees[i] - triees[i - 1] >= 3 * MIN, `réseaux espacés dans un passage (tour ${tour})`);
    }
  }
});
