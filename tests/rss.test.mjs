import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDescription, decodeEntities } from '../src/sources/rss.mjs';

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

test('entités HTML', () => {
  assert.equal(decodeEntities('A &amp; B &#8217; C&nbsp;D &hellip;'), 'A & B ’ C D …');
});
