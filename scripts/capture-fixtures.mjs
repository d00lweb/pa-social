// Enregistre 12 articles réels et variés du flux dans tests/fixtures/articles.json
import { writeFile } from 'node:fs/promises';
import { fetchItems } from '../src/sources/rss.mjs';
import { fromRoot } from '../src/core/config.mjs';

const FEED = process.env.RSS_URL || 'https://passion-aquitaine.ouest-france.fr/feed/';
const TARGET = 12;

const all = new Map();
for (let page = 1; page <= 5; page++) {
  try {
    for (const item of await fetchItems(page === 1 ? FEED : `${FEED}?paged=${page}`)) all.set(item.guid, item);
  } catch {
    break;
  }
}
const items = [...all.values()];
const text = (a) => `${a.title} ${a.description} ${a.categories.join(' ')}`;

const picks = new Map();
const pick = (label, test) => {
  const found = items.find((a) => !picks.has(a.guid) && test(a));
  if (found) picks.set(found.guid, { label, ...found });
};

pick('titre très long', (a) => a.title.length > 95);
pick('guillemets', (a) => /[«"]/.test(a.title));
pick('chiffre + unité', (a) => /\d\s?(°C|%|€|km)/.test(a.title));
pick('milliers', (a) => /\d{1,3}[   ]\d{3}/.test(a.title));
pick('Pays basque', (a) => /Pays basque|Bayonne|Biarritz|Anglet|Saint-Jean-de-Luz|Hendaye|Espelette/i.test(text(a)));
pick('Béarn', (a) => /Béarn|\bPau\b|Oloron|Orthez|Jurançon/i.test(text(a)));
pick('hors région', (a) => /Espagne|Portugal|Italie|\bParis\b/i.test(a.title));
pick('sujet sensible', (a) => /\bmort|décès|accident|incendie|drame|victime|tué|meurtre|condamn/i.test(text(a)));
pick('événement daté', (a) => /\b\d{1,2} (janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\b|week-end/i.test(text(a)));
pick('catégorie générique seule', (a) => a.categories.length === 1 && /^actu/i.test(a.categories[0]));
pick('titre-question', (a) => /\?\s*$/.test(a.title));
pick('amorce géographique', (a) => /^(En|À|Dans|Au|Aux) [^,]+, /.test(a.title));
for (const a of items) {
  if (picks.size >= TARGET) break;
  if (!picks.has(a.guid)) picks.set(a.guid, { label: 'cas standard', ...a });
}

const fixtures = [...picks.values()].slice(0, TARGET);
await writeFile(fromRoot('tests/fixtures/articles.json'), `${JSON.stringify(fixtures, null, 2)}\n`);
console.log(`${items.length} articles lus, ${fixtures.length} enregistrés :`);
for (const f of fixtures) console.log(`  [${f.label}] ${f.title}`);
