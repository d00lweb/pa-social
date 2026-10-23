import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDescription, decodeEntities, matchArticle } from '../src/sources/rss.mjs';

test('description : premier paragraphe seul, entités décodées, apostrophes typographiques', () => {
  const html = '<p>Au musée d&#039;Aquitaine à Bordeaux, le monument dédié à Montaigne est resté vide pendant des siècles, le vrai tombeau ne fut retrouvé qu&#039;en 2018.</p>\n<p>L’article <a href="https://example.org/">Le corps de Montaigne</a> est apparu en premier sur <a href="https://example.org">Passion Aquitaine</a>.</p>';
  assert.equal(
    cleanDescription(html),
    'Au musée d’Aquitaine à Bordeaux, le monument dédié à Montaigne est resté vide pendant des siècles, le vrai tombeau ne fut retrouvé qu’en 2018.',
  );
});

test('description : parenthèse finale courte (ajout SEO) supprimée', () => {
  assert.equal(cleanDescription('<p>Un lieu étonnant (Photo : AFP).</p>'), 'Un lieu étonnant.');
  assert.equal(cleanDescription('<p>Texte (une longue précision qui dépasse clairement quarante caractères).</p>'), 'Texte (une longue précision qui dépasse clairement quarante caractères).');
});

test('relance : article retrouvé par mots du titre, accents ignorés, identifiant exact prioritaire', () => {
  const items = [
    { title: 'En Haute-Vienne, les abeilles tuent le frelon asiatique', guid: 'https://exemple.fr/?p=1', link: 'https://exemple.fr/abeilles', date: 300 },
    { title: 'Les abeilles noires du Béarn', guid: 'https://exemple.fr/?p=2', link: 'https://exemple.fr/noires', date: 900 },
    { title: 'Le corps de Montaigne', guid: 'https://exemple.fr/?p=3', link: 'https://exemple.fr/montaigne', date: 100 },
  ];
  assert.equal(matchArticle(items, 'abeilles').guid, 'https://exemple.fr/?p=2', 'le plus récent des articles correspondants');
  assert.equal(matchArticle(items, 'abeilles frelon').guid, 'https://exemple.fr/?p=1');
  assert.equal(matchArticle(items, 'BEARN').guid, 'https://exemple.fr/?p=2');
  assert.equal(matchArticle(items, 'https://exemple.fr/?p=1').guid, 'https://exemple.fr/?p=1');
  assert.equal(matchArticle(items, 'https://exemple.fr/montaigne').guid, 'https://exemple.fr/?p=3');
  assert.equal(matchArticle(items, 'hippocampes'), null);
  assert.equal(matchArticle(items, '  '), null);
});

test('entités HTML', () => {
  assert.equal(decodeEntities('A &amp; B &#8217; C&nbsp;D &hellip;'), 'A & B ’ C D …');
});

// 22/10/2026 : deux réponses « 500 » du site ont fait échouer deux passages entiers. Le flux en panne
// ne doit plus bloquer ce qui est déjà programmé.
test('flux en panne : un second essai, puis le passage continue sans nouveaux articles', async () => {
  const { lireFlux } = await import('../src/sources/rss.mjs');
  const H = 3600e3;
  const t0 = Date.parse('2026-10-22T06:39:00Z');
  const panne = async () => { throw new Error('Flux RSS 500 : https://site/feed/'); };
  const alertes = [];
  const opts = (now, lire = panne) => ({ now, lire, attendre: async () => {}, alerter: async (h, d) => alertes.push([Math.round(h), d]), log: () => {} });
  const memory = {};

  // première panne : rien d'envoyé, la panne est datée
  let essais = 0;
  const r = await lireFlux('u', memory, opts(t0, async () => { essais++; throw new Error('Flux RSS 500 : https://site/feed/'); }));
  assert.deepEqual(r, { items: [], ok: false });
  assert.equal(essais, 2, 'un second essai avant de renoncer');
  assert.equal(memory.fluxEnPanneDepuis, t0);
  assert.equal(alertes.length, 0, 'pas d’alerte pour une panne passagère');

  // trois heures plus tard : une alerte, une seule pour la journée
  await lireFlux('u', memory, opts(t0 + 3 * H));
  await lireFlux('u', memory, opts(t0 + 4 * H));
  assert.deepEqual(alertes, [[3, 'Flux RSS 500 : https://site/feed/']]);

  // le flux répond : les articles reviennent et la mémoire est nettoyée
  const ok = await lireFlux('u', memory, opts(t0 + 5 * H, async () => [{ guid: 'a' }]));
  assert.deepEqual(ok, { items: [{ guid: 'a' }], ok: true });
  assert.deepEqual(memory, {});
  // un essai raté puis réussi : aucune trace
  let n = 0;
  assert.equal((await lireFlux('u', memory, opts(t0, async () => { if (n++ === 0) throw new Error('500'); return []; }))).ok, true);
  assert.deepEqual(memory, {});
});
