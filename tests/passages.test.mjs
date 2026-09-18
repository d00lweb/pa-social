import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prochainPassage } from '../src/measure/pilotage.mjs';

// Le robot ne tourne qu'à :00 et :20. Annoncer l'heure théorique de la file (« prévu 12:22 »)
// est trompeur : rien ne peut partir avant le passage suivant. La page doit dire 13:00.

const iso = (s) => new Date(s).toISOString();

test('une échéance entre deux passages attend le suivant', () => {
  assert.equal(prochainPassage('2026-09-18T10:22:00Z', Date.parse('2026-09-18T10:00:00Z')).toISOString(), iso('2026-09-18T11:00:00Z'));
  assert.equal(prochainPassage('2026-09-18T10:05:00Z', Date.parse('2026-09-18T10:00:00Z')).toISOString(), iso('2026-09-18T10:20:00Z'));
});

test('une échéance pile sur un passage part à ce passage', () => {
  assert.equal(prochainPassage('2026-09-18T10:20:00Z', Date.parse('2026-09-18T10:00:00Z')).toISOString(), iso('2026-09-18T10:20:00Z'));
});

test('un post en retard part au prochain passage à partir de maintenant', () => {
  const tard = prochainPassage('2026-09-18T08:00:00Z', Date.parse('2026-09-18T10:05:00Z'));
  assert.equal(tard.toISOString(), iso('2026-09-18T10:20:00Z'), 'jamais une heure déjà passée');
});

test('le passage de minuit fait changer de jour', () => {
  assert.equal(prochainPassage('2026-09-18T23:50:00Z', Date.parse('2026-09-18T23:00:00Z')).toISOString(), iso('2026-09-19T00:00:00Z'));
});

test('les secondes ne décalent pas le passage', () => {
  assert.equal(prochainPassage('2026-09-18T10:19:30Z', Date.parse('2026-09-18T10:00:00Z')).toISOString(), iso('2026-09-18T10:20:00Z'));
});
