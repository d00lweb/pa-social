import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueHebdo, dueMensuel, estLundi, mois } from '../src/measure/diffusion.mjs';

// Le robot passe toutes les 20 minutes : sans marqueur, le rapport du lundi partirait des dizaines de fois.
const t = (iso) => new Date(iso).getTime();

test('rapport hebdomadaire : le lundi, après 8 h, une seule fois', () => {
  assert.ok(estLundi(t('2026-09-14T10:00:00Z')), '14/09/2026 est un lundi');
  assert.ok(!estLundi(t('2026-09-15T10:00:00Z')));

  const lundiTot = t('2026-09-14T04:00:00Z');   // 6 h à Paris
  const lundiMatin = t('2026-09-14T07:00:00Z'); // 9 h à Paris
  assert.equal(dueHebdo({}, lundiTot), false, 'pas avant 8 h');
  assert.equal(dueHebdo({}, lundiMatin), true);
  assert.equal(dueHebdo({ dernierHebdo: '2026-09-14' }, lundiMatin), false, 'déjà envoyé aujourd’hui');
  assert.equal(dueHebdo({ dernierHebdo: '2026-09-07' }, lundiMatin), true, 'la semaine suivante, il repart');
  assert.equal(dueHebdo({}, t('2026-09-16T07:00:00Z')), false, 'un mercredi, jamais');
});

test('rapport mensuel : le mois écoulé est figé une seule fois', () => {
  const debutOctobre = t('2026-10-02T09:00:00Z');
  assert.equal(dueMensuel({}, debutOctobre), '2026-09', 'au début octobre, septembre est clos');
  assert.equal(dueMensuel({ dernierMensuel: '2026-09' }, debutOctobre), null, 'jamais deux fois');
  assert.equal(dueMensuel({}, t('2026-10-20T09:00:00Z')), null, 'en milieu de mois, rien à figer');
  assert.equal(mois(t('2026-09-17T22:30:00Z')), '2026-09', 'mois calculé à l’heure de Paris');
});
