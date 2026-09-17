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
