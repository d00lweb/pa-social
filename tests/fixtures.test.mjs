import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fallbackDossier } from '../src/brain/fallback.mjs';
import { splitAround } from '../src/brain/editorial.mjs';
import { fold } from '../src/brain/geo.mjs';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/articles.json', import.meta.url), 'utf8'));
const ed = JSON.parse(readFileSync(new URL('../config/editorial.json', import.meta.url), 'utf8'));
const stop = new Set(ed.stopwords.map(fold));

test('fixtures : au moins 12 articles réels', () => {
  assert.ok(fixtures.length >= 12);
});

for (const article of fixtures) {
  test(`règles de secours : [${article.label}] ${article.title}`, () => {
    const d = fallbackDossier(article);
    assert.ok(d.rubrique && !ed.genericCategories.includes(fold(d.rubrique)) && !/LOI$/.test(d.rubrique), `rubrique : ${d.rubrique}`);
    const { before, highlight, after } = splitAround(d.visuel.titre, d.visuel.surlignage);
    assert.equal(before + highlight + after, d.visuel.titre);
    const words = highlight.split(/[\s  ]+/);
    assert.ok(!stop.has(fold(words[0])) && !stop.has(fold(words.at(-1))), `surlignage en bordure de petit mot : ${highlight}`);
    assert.equal(d.instagram.hashtags.length, 3);
  });
}

test('rubriques identitaires sur les cas limites', () => {
  const byLabel = Object.fromEntries(fixtures.map((a) => [a.label, fallbackDossier(a)]));
  assert.equal(byLabel['Pays basque'].rubrique, 'Pays basque');
  assert.equal(byLabel['Béarn'].rubrique, 'Béarn');
  assert.notEqual(byLabel['catégorie générique seule'].rubrique, 'Actus');
});
