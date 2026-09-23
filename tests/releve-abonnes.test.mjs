import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releverAbonnes } from '../src/measure/abonnes.mjs';

// 23/09/2026 : jeton Meta refusé au premier passage du jour. Les cases Facebook et Instagram ont été
// écrites à « null », et comme la case existait, aucun passage suivant ne réessayait : la journée
// entière est restée sans chiffre, alors que le jeton a été réparé dans l'après-midi.

const etat = (contenu) => {
  const dir = mkdtempSync(join(tmpdir(), 'pa-abonnes-'));
  writeFileSync(join(dir, 'abonnes.json'), JSON.stringify(contenu));
  return dir;
};
const lu = (dir) => JSON.parse(readFileSync(join(dir, 'abonnes.json'), 'utf8'));
const now = Date.parse('2026-09-23T16:00:00Z'); // 18 h à Paris
const jour = '2026-09-23';

test('un compte illisible le matin est réessayé, et enregistré dès qu’il répond', async () => {
  const dir = etat({ [jour]: { instagram: null, facebook: null, bluesky: 3, threads: 1148 } });
  const appels = [];
  const lecteurs = {
    instagram: async () => { appels.push('instagram'); return 10145; },
    facebook: async () => { appels.push('facebook'); return 42616; },
    bluesky: async () => { appels.push('bluesky'); return 99; },
    threads: async () => { appels.push('threads'); return 99; },
  };
  await releverAbonnes({ now, dir, lecteurs, log: () => {} });
  assert.deepEqual(appels.sort(), ['facebook', 'instagram'], 'seuls les comptes sans chiffre sont relus');
  assert.deepEqual(lu(dir)[jour], { instagram: 10145, facebook: 42616, bluesky: 3, threads: 1148 }, 'les valeurs déjà connues ne bougent pas');
});

test('une journée complète ne déclenche plus aucun appel', async () => {
  const dir = etat({ [jour]: { instagram: 1, facebook: 2, bluesky: 3, threads: 4 } });
  let appels = 0;
  const lecteurs = Object.fromEntries(['instagram', 'facebook', 'bluesky', 'threads'].map((id) => [id, async () => { appels += 1; return 0; }]));
  await releverAbonnes({ now, dir, lecteurs, log: () => {} });
  assert.equal(appels, 0);
});

test('une saisie manuelle de X n’empêche pas le relevé automatique', async () => {
  const dir = etat({ [jour]: { x: 2940 } });
  const lecteurs = { instagram: async () => 10, facebook: async () => 20, bluesky: async () => 30, threads: async () => 40 };
  await releverAbonnes({ now, dir, lecteurs, log: () => {} });
  assert.deepEqual(lu(dir)[jour], { x: 2940, instagram: 10, facebook: 20, bluesky: 30, threads: 40 });
});
