import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cout, resume, TARIFS } from '../src/brain/couts.mjs';

// Le 23/09/2026, une estimation « à la main » annonçait 3,2 centimes par appel ; la mesure réelle
// en donnait 5,5. L'écart venait de l'entrée, largement sous-évaluée : la consigne et le contexte
// pèsent environ 85 % d'un appel. D'où ce relevé : on ne calcule plus, on compte les jetons
// facturés — et « npm run couts:sync » va chercher le montant facturé par Anthropic, qui fait foi.

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

test('Sonnet 5.5 et Opus 5.5 : comptés à leur prix, pas à celui d’Opus 5 par défaut', async () => {
  const { cout, tarifDe, TARIFS } = await import('../src/brain/couts.mjs');
  // 29/09/2026 : absent de la table, Sonnet 5.5 aurait été compté au tarif Opus 5, 2,5 fois trop cher
  assert.deepEqual(tarifDe('claude-sonnet-5-5'), { entree: 2, sortie: 10 });
  assert.deepEqual(tarifDe('claude-sonnet-5-5'), TARIFS['claude-sonnet-5'], 'même prix par jeton que Sonnet 5');
  const usage = { input_tokens: 10000, output_tokens: 2000, cache_read_input_tokens: 10000 };
  assert.equal(Math.round(cout(usage, 'claude-sonnet-5-5') * 1e4) / 1e4, 0.042, '10 000 × 2 + 10 000 × 0,2 + 2 000 × 10 millionièmes');
  // Opus 5.5 facture la lecture de cache 5 % du prix d'entrée, pas 10 %
  assert.equal(Math.round(cout(usage, 'claude-opus-5-5') * 1e4) / 1e4, 0.082, '10 000 × 4 + 10 000 × 0,2 + 2 000 × 20 millionièmes');
});

// Faux registre des problèmes : on regarde ce qui est signalé et réglé, rien ne part
const registre = () => {
  const appels = [];
  return { appels, signaler: async (cle, o) => { appels.push(['signaler', cle, o]); }, regler: async (cle, o) => { appels.push(['regler', cle, o]); return true; } };
};

test('rédacteur injoignable : un problème tant que ça dure, réglé quand il répond', async () => {
  const { signalerIaIndisponible, iaRetablie } = await import('../src/brain/couts.mjs');
  const { fromRoot } = await import('../src/core/config.mjs');
  const { readFile, writeFile, rm } = await import('node:fs/promises');
  const avant = await readFile(fromRoot('state/ia.json'), 'utf8').catch(() => null);
  try {
    const p = registre();
    const jour1 = Date.parse('2026-09-24T08:00:00Z');
    assert.equal(await signalerIaIndisponible('400 Your credit balance is too low', { now: jour1, problemes: p }), true);
    await signalerIaIndisponible('panne réseau', { now: jour1 + 26 * 3600e3, problemes: p });
    // la cadence (un message, un rappel par semaine) est celle du registre : ici, la même clé à chaque fois
    assert.deepEqual(p.appels.map(([quoi, cle]) => `${quoi} ${cle}`), ['signaler ia', 'signaler ia']);
    assert.match(p.appels[0][2].message.text, /Plus de crédit sur la clé Claude/, 'le manque de crédit est nommé');
    assert.match(p.appels[0][2].message.reply_markup, /console\.anthropic\.com/, 'avec le lien pour recharger');
    assert.match(p.appels[1][2].message.text, /Rédacteur IA injoignable/, 'une panne ordinaire ne parle pas de crédit');
    await iaRetablie({ problemes: p });
    assert.equal(p.appels[2][1], 'ia');
    assert.match(p.appels[2][2].message.text, /^✅ <b>Réglé<\/b>/);
  } finally {
    await (avant === null ? rm(fromRoot('state/ia.json'), { force: true }) : writeFile(fromRoot('state/ia.json'), avant));
  }
});

test('budget du mois : dépense, part du plafond, dépassement', async () => {
  const { budgetDuMois, BUDGET_MOIS } = await import('../src/brain/couts.mjs');
  const jour = (cout) => ({ '2026-09-23': { appels: 1, entree: 0, sortie: 0, cout, parModele: {}, parUsage: {} } });
  const now = Date.parse('2026-09-23T16:00:00Z');
  // 23/09/2026 : 3 $ était un chiffre posé avant d'avoir mesuré. L'essai comparatif donne 0,091 $
  // par article avec Opus 5, soit 4,65 $ par mois au rythme relevé de 1,7 article par jour.
  assert.equal(BUDGET_MOIS, 6, 'plafond fixé à 6 $ par mois');
  assert.equal(budgetDuMois(jour(2.4), now).depasse, false);
  assert.equal(Math.round(budgetDuMois(jour(4.2), now).part * 100), 70, 'seuil d’alerte');
  assert.equal(budgetDuMois(jour(6), now).depasse, true, 'au plafond, le rédacteur n’est plus appelé');
  assert.equal(budgetDuMois({}, now).depense, 0);
  // seuls les jours du mois en cours comptent
  assert.equal(budgetDuMois({ '2026-08-31': { appels: 9, cout: 9 } }, now).depense, 0);
});

test('au plafond, on prévient sans couper : le réglage est explicite', async () => {
  const { COUPER_AU_PLAFOND, verifierBudget } = await import('../src/brain/couts.mjs');
  assert.equal(COUPER_AU_PLAFOND, false, 'par défaut le rédacteur continue : une publication dégradée coûte plus cher que quelques centimes');
  const { budget } = await import('../src/channels/messages.mjs');
  assert.doesNotMatch(budget({ depense: 6.4, budget: 6 }, { couperAuPlafond: false }).text, /version de secours/, 'tant que couperAuPlafond est faux, aucun message ne promet une coupure');
  // sur le relevé réel : un dépassement est signalé, sinon le problème est réglé (plus d'alerte à 70 %)
  const p = registre();
  const etat = await verifierBudget({ now: Date.parse('2026-09-24T09:00:00Z'), problemes: p });
  assert.equal(p.appels.length, 1);
  assert.deepEqual(p.appels[0].slice(0, 2), [etat.depasse ? 'signaler' : 'regler', 'budget']);
});

test('le budget compte tout ce qui est facturé, et dit d’où la dépense vient', async () => {
  const { budgetDuMois } = await import('../src/brain/couts.mjs');
  const now = Date.parse('2026-09-23T16:00:00Z');
  // 23/09/2026 : sur les 1,51 $ facturés ce jour-là, 7 centimes venaient du robot, le reste d'une
  // séance de réglages. Tout part du même compte Anthropic : le budget compte tout et dit la part
  // de chacun. Écarter les mises au point afficherait 0,07 $ quand la console en montre 1,51.
  const releve = {
    '2026-09-23': {
      appels: 27, entree: 0, sortie: 0, cout: 1.514,
      parOrigine: { robot: { appels: 1, cout: 0.075 }, local: { appels: 26, cout: 1.439 } },
    },
  };
  const etat = budgetDuMois(releve, now);
  assert.equal(etat.depense, 1.514, 'le budget suit ce qui est facturé, comme la console');
  assert.equal(etat.robot, 0.075, 'la part des publications reste lisible');
  assert.equal(etat.local, 1.439, 'celle des mises au point aussi');
  assert.equal(etat.depasse, false);
  // un relevé antérieur au partage n'a pas d'origine : il est attribué au robot, comme avant
  const ancien = budgetDuMois({ '2026-09-23': { appels: 3, cout: 0.21 } }, now);
  assert.equal(ancien.depense, 0.21);
  assert.equal(ancien.robot, 0.21);
});

test('le montant facturé par Anthropic prime sur le relevé maison', async () => {
  const { budgetDuMois } = await import('../src/brain/couts.mjs');
  const now = Date.parse('2026-09-23T16:00:00Z');
  // Le relevé maison ne démarre qu'au jour de sa mise en service : il ignorait tout le début du
  // mois. « npm run couts:sync » va chercher la facturation réelle, qui fait foi.
  const releve = { '2026-09-23': { appels: 27, cout: 1.514 } };
  const facture = { maj: '2026-09-23T17:00:00Z', jours: { '2026-09-17': 2.8, '2026-09-23': 1.4 }, total: 4.2 };
  const etat = budgetDuMois(releve, now, 'Europe/Paris', facture);
  assert.equal(etat.depense, 4.2, 'les jours antérieurs au relevé comptent aussi');
  assert.equal(Math.round(etat.part * 100), 70, 'l’alerte des 70 % part sur le montant facturé');
  // la facturation peut avoir quelques heures de retard : on ne descend jamais sous le relevé
  const enRetard = budgetDuMois(releve, now, 'Europe/Paris', { maj: '2026-09-23T06:00:00Z', jours: { '2026-09-23': 0.2 } });
  assert.equal(enRetard.depense, 1.514, 'le plus élevé des deux l’emporte');
  // un mois précédent ne compte pas
  assert.equal(budgetDuMois({}, now, 'Europe/Paris', { jours: { '2026-08-30': 12 } }).depense, 0);
});
