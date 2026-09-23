import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cout, resume, TARIFS } from '../src/brain/couts.mjs';

// Le 23/09/2026, une estimation « à la main » annonçait 3,2 centimes par appel ; la mesure réelle
// en donnait 5,5. L'écart venait de l'entrée sous-évaluée et de la réflexion du modèle, facturée
// avec la sortie. D'où ce relevé : on ne calcule plus, on compte ce que l'API a facturé.

test('coût d’un appel : entrée, sortie, et cache à son vrai prix', () => {
  const usage = { input_tokens: 6393, output_tokens: 856 };
  // 6393/1M × 5 $ + 856/1M × 25 $ = 0,0320 + 0,0214
  assert.equal(Math.round(cout(usage, 'claude-opus-5') * 1e4) / 1e4, 0.0534);
  assert.equal(Math.round(cout(usage, 'claude-sonnet-5') * 1e4) / 1e4, 0.0213, 'Sonnet coûte 2,5 fois moins');
  assert.equal(cout(usage, 'modèle-inconnu'), cout(usage, 'claude-opus-5'), 'modèle inconnu : tarif Opus, jamais zéro');
  const avecCache = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1e6, cache_creation_input_tokens: 1e6 };
  assert.equal(cout(avecCache, 'claude-opus-5'), 5 * 0.1 + 5 * 1.25, 'lecture de cache 10 %, écriture 125 %');
  assert.equal(cout({}, 'claude-opus-5'), 0);
});

const releve = {
  '2026-09-20': { appels: 4, entree: 24000, sortie: 3400, cout: 0.205, parModele: { 'claude-opus-5': 4 }, parUsage: { dossier: 4 } },
  '2026-09-22': { appels: 6, entree: 38000, sortie: 5200, cout: 0.32, parModele: { 'claude-opus-5': 6 }, parUsage: { dossier: 5, apercu: 1 } },
  '2026-09-23': { appels: 2, entree: 12787, sortie: 1822, cout: 0.1095, parModele: { 'claude-opus-5': 2 }, parUsage: { dossier: 2 } },
};
const now = Date.parse('2026-09-23T16:00:00Z');

test('vue du mois : cumuls, moyenne par appel et projection', () => {
  const r = resume(releve, now);
  assert.equal(r.jour.appels, 2);
  assert.equal(Math.round(r.jour.cout * 1e4) / 1e4, 0.1095);
  assert.equal(r.semaine.appels, 12, 'les 7 derniers jours, jour courant compris');
  assert.equal(Math.round(r.mois.cout * 100) / 100, 0.63);
  assert.equal(r.mois.cle, '2026-09');
  // 0,6345 $ en 23 jours → 0,0276 par jour → 0,83 $ sur 30 jours
  assert.equal(r.projection, 0.83);
  assert.equal(r.moyenneAppel, 0.0529, 'coût moyen d’un appel, mesuré');
  assert.deepEqual(r.parModele, { 'claude-opus-5': 12 });
});

test('la courbe couvre 14 jours pleins, les jours sans appel à zéro', () => {
  const r = resume(releve, now);
  assert.equal(r.serie.length, 14);
  assert.deepEqual(r.serie.at(-1), ['2026-09-23', 0.1095]);
  assert.deepEqual(r.serie.at(-2), ['2026-09-22', 0.32]);
  assert.deepEqual(r.serie.at(-3), ['2026-09-21', 0], 'jour sans appel : zéro, pas un trou');
  assert.equal(r.depuis, '2026-09-20');
});

test('relevé vide : tout à zéro, jamais d’erreur', () => {
  const r = resume({}, now);
  assert.equal(r.mois.cout, 0);
  assert.equal(r.projection, 0);
  assert.equal(r.moyenneAppel, 0);
  assert.equal(r.serie.length, 14);
  assert.equal(r.depuis, null);
  assert.ok(TARIFS['claude-opus-5'].sortie > TARIFS['claude-opus-5'].entree);
});

test('modèle daté : le tarif est retrouvé, pas celui d’Opus par défaut', async () => {
  const { tarifDe, TARIFS } = await import('../src/brain/couts.mjs');
  // l'API renvoie « claude-haiku-4-5-20251001 » : sans normalisation, 0,90 centime devenait 4,50
  assert.deepEqual(tarifDe('claude-haiku-4-5-20251001'), TARIFS['claude-haiku-4-5']);
  assert.deepEqual(tarifDe('claude-sonnet-5'), TARIFS['claude-sonnet-5']);
  assert.deepEqual(tarifDe('modèle-inconnu'), TARIFS['claude-opus-5'], 'modèle inconnu : le tarif le plus cher, jamais une sous-estimation');
});

test('rédacteur injoignable : une alerte par jour, et le manque de crédit est nommé', async () => {
  const { signalerIaIndisponible } = await import('../src/brain/couts.mjs');
  const envoyes = [];
  const envoyer = async (t) => envoyes.push(t);
  const jour1 = Date.parse('2026-09-24T08:00:00Z');
  assert.equal(await signalerIaIndisponible('400 Your credit balance is too low', { now: jour1, envoyer }), true);
  assert.equal(await signalerIaIndisponible('toujours la même panne', { now: jour1 + 4 * 3600e3, envoyer }), false, 'pas de rappel toutes les 20 minutes');
  assert.equal(await signalerIaIndisponible('panne réseau', { now: jour1 + 26 * 3600e3, envoyer }), true, 'un rappel par jour tant que ça dure');
  assert.match(envoyes[0], /Plus de crédit/, 'le manque de crédit est nommé, avec la marche à suivre');
  assert.match(envoyes[0], /console\.anthropic\.com/);
  assert.match(envoyes[1], /injoignable/, 'une panne ordinaire ne parle pas de crédit');
});

test('budget du mois : alerte à 70 %, plus aucun appel au-delà de 100 %', async () => {
  const { budgetDuMois, BUDGET_MOIS } = await import('../src/brain/couts.mjs');
  const jour = (cout) => ({ '2026-09-23': { appels: 1, entree: 0, sortie: 0, cout, parModele: {}, parUsage: {} } });
  const now = Date.parse('2026-09-23T16:00:00Z');
  assert.equal(BUDGET_MOIS, 3, 'plafond fixé à 3 $ par mois');
  assert.equal(budgetDuMois(jour(1.2), now).depasse, false);
  assert.equal(Math.round(budgetDuMois(jour(2.1), now).part * 100), 70, 'seuil d’alerte');
  assert.equal(budgetDuMois(jour(3), now).depasse, true, 'au plafond, le rédacteur n’est plus appelé');
  assert.equal(budgetDuMois({}, now).depense, 0);
  // seuls les jours du mois en cours comptent
  assert.equal(budgetDuMois({ '2026-08-31': { appels: 9, cout: 9 } }, now).depense, 0);
});

test('au plafond, on prévient sans couper : le réglage est explicite', async () => {
  const { COUPER_AU_PLAFOND, verifierBudget } = await import('../src/brain/couts.mjs');
  assert.equal(COUPER_AU_PLAFOND, false, 'par défaut le rédacteur continue : une publication dégradée coûte plus cher que quelques centimes');
  const envoyes = [];
  // le relevé réel sert de base : on vérifie seulement la forme du message, pas le montant
  await verifierBudget({ now: Date.parse('2026-09-24T09:00:00Z'), envoyer: async (t) => envoyes.push(t) });
  if (envoyes.length) assert.doesNotMatch(envoyes[0], /version de secours/, 'tant que couperAuPlafond est faux, aucun message ne promet une coupure');
});
