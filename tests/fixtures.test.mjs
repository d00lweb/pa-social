import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickRubrique, stripGeoLead, splitHighlight, frenchTypography } from '../src/brain/editorial.mjs';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/articles.json', import.meta.url), 'utf8'));

test('fixtures : au moins 12 articles réels', () => {
  assert.ok(fixtures.length >= 12);
});

for (const article of fixtures) {
  test(`règles éditoriales : [${article.label}] ${article.title}`, () => {
    const rubrique = pickRubrique(article.categories);
    const title = frenchTypography(stripGeoLead(article.title, rubrique));
    const { before, highlight, after } = splitHighlight(title);
    assert.ok(rubrique, 'rubrique vide');
    assert.ok(highlight, 'groupe surligné vide');
    assert.equal(before + highlight + after, title);
    assert.ok([...highlight].length <= 30, `surlignage trop long : ${highlight}`);
  });
}
