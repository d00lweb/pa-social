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
  const envoyes = [];
  // le relevé réel sert de base : on vérifie seulement la forme du message, pas le montant.
  // La mémoire des alertes est remise comme elle était : un test ne doit pas consommer l'alerte
  // du jour, sinon le vrai dépassement passerait sous silence.
  const { fromRoot } = await import('../src/core/config.mjs');
  const { readFile, writeFile, rm } = await import('node:fs/promises');
  const avant = await readFile(fromRoot('state/ia.json'), 'utf8').catch(() => null);
  try {
    await verifierBudget({ now: Date.parse('2026-09-24T09:00:00Z'), envoyer: async (t) => envoyes.push(t) });
    if (envoyes.length) assert.doesNotMatch(envoyes[0], /version de secours/, 'tant que couperAuPlafond est faux, aucun message ne promet une coupure');
  } finally {
    await (avant === null ? rm(fromRoot('state/ia.json'), { force: true }) : writeFile(fromRoot('state/ia.json'), avant));
  }
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

test('point conso : le dimanche vers 19 h, une seule fois, sur les 7 derniers jours', async () => {
  const { resumeHebdoCouts } = await import('../src/brain/couts.mjs');
  const { fromRoot } = await import('../src/core/config.mjs');
  const { readFile, writeFile, mkdir, rm } = await import('node:fs/promises');
  // couts-console.json est repris ici aussi : le point du dimanche se cale sur la facturation
  // réelle quand elle est présente, et le relevé du poste ne doit pas s'inviter dans le test.
  const fichiers = ['state/ia.json', 'state/couts.json', 'state/couts-console.json'];
  const sauve = await Promise.all(fichiers.map((f) => readFile(fromRoot(f), 'utf8').catch(() => null)));
  await mkdir(fromRoot('state'), { recursive: true });
  const jours = {};
  for (let i = 0; i < 7; i++) {
    const j = new Date(Date.parse('2026-09-27T12:00:00Z') - i * 86400e3).toISOString().slice(0, 10);
    jours[j] = { appels: 4, entree: 0, sortie: 0, cout: 0.24, parOrigine: { robot: { appels: 3, cout: 0.18 }, local: { appels: 1, cout: 0.06 } } };
  }
  try {
    await writeFile(fromRoot('state/couts.json'), JSON.stringify(jours));
    await writeFile(fromRoot('state/ia.json'), '{}');
    await writeFile(fromRoot('state/couts-console.json'), JSON.stringify({ maj: '2026-09-27T17:00:00Z', source: 'saisie', mois: '2026-09', total: 1.4 }));
    const envoyes = [];
    const envoyer = async (m) => { envoyes.push(m); };
    // dimanche 27 septembre 2026 : rien avant 19 h (heure de Paris)
    assert.equal(await resumeHebdoCouts({ now: Date.parse('2026-09-27T14:00:00Z'), envoyer }), null, 'pas de point l’après-midi');
    // samedi soir non plus : le point est hebdomadaire
    assert.equal(await resumeHebdoCouts({ now: Date.parse('2026-09-26T18:00:00Z'), envoyer }), null, 'pas de point le samedi');
    assert.equal(envoyes.length, 0);

    const r = await resumeHebdoCouts({ now: Date.parse('2026-09-27T17:10:00Z'), envoyer });
    assert.ok(r, 'dimanche 19 h 10 à Paris : le point part');
    assert.equal(r.semaine.appels, 21, '7 jours × 3 articles du robot');
    assert.match(envoyes[0], /la semaine/);
    assert.match(envoyes[0], /21 articles rédigés/);
    // le relevé maison compte 1,68 $, la facturation saisie 1,40 : on ne descend jamais sous le relevé
    assert.match(envoyes[0], /Ce mois-ci : <b>1,68 \$<\/b>/, 'le mois annoncé est celui facturé, tout compris');
    assert.match(envoyes[0], /Dont 1,26 \$ de publications et 0,42 \$ de mises au point/, 'la part de chacun est dite');
    assert.doesNotMatch(envoyes[0], /\n\n/, 'aucune ligne vide dans le message');

    assert.equal(await resumeHebdoCouts({ now: Date.parse('2026-09-27T19:00:00Z'), envoyer }), null, 'une seule fois dans la soirée');
    assert.equal(envoyes.length, 1);
  } finally {
    // un fichier absent avant le test le reste après : sinon le test laisserait derrière lui une
    // facturation inventée, que la page et les alertes prendraient pour argent comptant
    await Promise.all(fichiers.map((f, i) => (sauve[i] === null ? rm(fromRoot(f), { force: true }) : writeFile(fromRoot(f), sauve[i]))));
  }
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
