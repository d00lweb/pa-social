import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agreger, conseils, messageHebdo, parPost, creneau, interactions } from '../src/measure/rapport.mjs';

const post = (guid, channel, jalon, likes, commentaires, publieLe) => ({
  guid, channel, jalon, likes, commentaires, partages: 0, publieLe, titre: `Article ${guid}`,
});

test('un post compte une fois : le relevé le plus tardif fait foi', () => {
  const mesures = [
    post('a', 'bluesky', 1, 2, 0, '2026-09-10T08:00:00Z'),
    post('a', 'bluesky', 7, 9, 1, '2026-09-10T08:00:00Z'),
  ];
  const retenus = parPost(mesures);
  assert.equal(retenus.length, 1);
  assert.equal(retenus[0].jalon, 7, 'J+7 remplace J+1, jamais l’inverse');
  assert.equal(interactions(retenus[0]), 10);
});

test('créneaux calculés à l’heure de Paris', () => {
  assert.equal(creneau('2026-09-10T06:30:00Z'), 'matin');      // 8 h 30 à Paris
  assert.equal(creneau('2026-09-10T13:00:00Z'), 'après-midi'); // 15 h
  assert.equal(creneau('2026-09-10T18:30:00Z'), 'soir');       // 20 h 30
});

test('bilan : classements par réseau, format, créneau, et effet des mentions', () => {
  const history = [
    { guid: 'a', channel: 'bluesky', format: 'card', mention: true },
    { guid: 'b', channel: 'bluesky', format: 'reply', mention: false },
    { guid: 'c', channel: 'instagram', format: null, mention: true },
  ];
  const mesures = [
    post('a', 'bluesky', 7, 10, 0, '2026-09-10T08:00:00Z'),
    post('b', 'bluesky', 7, 2, 0, '2026-09-11T19:00:00Z'),
    post('c', 'instagram', 7, 30, 4, '2026-09-12T08:00:00Z'),
  ];
  const bilan = agreger(mesures, { history });
  assert.equal(bilan.posts, 3);
  assert.equal(bilan.meilleur.guid, 'c');
  assert.equal(bilan.moinsBon.guid, 'b');
  assert.equal(Object.keys(bilan.parReseau)[0], 'instagram', 'le réseau le plus fort en tête');
  assert.equal(bilan.parFormat.card.moyenne, 10);
  assert.equal(bilan.mentions.avec.posts, 2);
  assert.equal(bilan.mentions.sans.posts, 1);
});

test('le rapport conseille mais n’applique rien', () => {
  const bilan = agreger([], {});
  const texte = messageHebdo(bilan);
  assert.match(texte, /Aucun post mesuré/);

  const history = Array.from({ length: 6 }, (_, i) => ({ guid: `g${i}`, channel: 'bluesky', format: i % 2 ? 'reply' : 'card', mention: i % 2 === 0 }));
  const mesures = history.map((h, i) => post(h.guid, 'bluesky', 7, i % 2 ? 1 : 12, 0, '2026-09-10T08:00:00Z'));
  const complet = agreger(mesures, { history });
  const avis = conseils(complet);
  assert.ok(avis.length >= 1);
  assert.match(avis.join(' '), /config\/channels\.json|créneau|mention/i, 'les conseils disent quoi changer et où');

  const message = messageHebdo(complet, { du: Date.parse('2026-09-07'), au: Date.parse('2026-09-13') });
  assert.match(message, /Aucun réglage n’a été modifié/, 'la promesse de ne rien changer est écrite noir sur blanc');
  assert.ok(message.length < 1800, `message court et lisible (${message.length} caractères)`);
});
