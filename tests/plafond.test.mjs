import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dayKey, countToday, nextDay, localHour } from '../src/core/scheduler.mjs';
import { fromRoot } from '../src/core/config.mjs';

const TZ = 'Europe/Paris';
const config = JSON.parse(readFileSync(fromRoot('config/channels.json'), 'utf8'));
const t = (iso) => new Date(iso).getTime();

test('compte du jour : heure de Paris, pas UTC', () => {
  // 23 h 30 à Paris = 21 h 30 UTC : la publication appartient bien au 17, pas au 18
  assert.equal(dayKey(t('2026-09-17T21:30:00Z'), TZ), '2026-09-17');
  const history = [
    { channel: 'facebook', at: '2026-09-17T06:10:00Z' },
    { channel: 'facebook', at: '2026-09-17T15:40:00Z' },
    { channel: 'facebook', at: '2026-09-16T15:40:00Z' },
    { channel: 'instagram', at: '2026-09-17T07:00:00Z' },
  ];
  assert.equal(countToday(history, 'facebook', t('2026-09-17T18:00:00Z'), TZ), 2);
  assert.equal(countToday(history, 'instagram', t('2026-09-17T18:00:00Z'), TZ), 1);
  assert.equal(countToday(history, 'facebook', t('2026-09-18T09:00:00Z'), TZ), 0, 'le compteur repart à zéro chaque jour');
});

test('réserve : ce qui dépasse le plafond part au premier créneau du lendemain', () => {
  const quiet = config.channels.facebook.quietHours;
  const demain = nextDay(t('2026-09-17T18:00:00Z'), quiet, TZ);
  assert.equal(dayKey(demain, TZ), '2026-09-18', 'reporté au jour suivant');
  const heure = localHour(demain, TZ);
  assert.ok(heure >= quiet.end && heure < quiet.start, `créneau ouvert (${heure} h), jamais pendant la nuit`);
});

test('plafonds configurés : 2 par jour sur Facebook, avec 3 h d’écart minimum', () => {
  const fb = config.channels.facebook;
  assert.equal(fb.maxPerDay, 2);
  assert.equal(fb.gapHours[0], 3, 'au moins 3 h entre deux posts Facebook');
  for (const [nom, canal] of Object.entries(config.channels)) {
    assert.ok(canal.maxPerDay >= 1, `${nom} : un plafond quotidien est défini`);
  }
});
