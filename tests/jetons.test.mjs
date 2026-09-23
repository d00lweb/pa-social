import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jetonInvalide, DeferError, GuardError } from '../src/core/errors.mjs';

// 23/09/2026 : le jeton Meta a été invalidé sans prévenir (mot de passe changé ou session coupée par
// Meta, code 190 sous-code 460). Chaque essai consommait une tentative : au troisième, l'article
// aurait été abandonné, alors que la publication n'y était pour rien.

test('un jeton refusé est reconnu, quelle que soit la forme de l’erreur', () => {
  const meta = Object.assign(new Error('Error validating access token: The session has been invalidated because the user changed their password or Facebook has changed the session for security reasons.'), { code: 190, subcode: 460 });
  assert.ok(jetonInvalide(meta));
  assert.ok(jetonInvalide(Object.assign(new Error('peu importe'), { code: 190 })), 'le code suffit');
  assert.ok(jetonInvalide(new Error('Session has expired on Saturday')), 'jeton Threads expiré');
  assert.ok(jetonInvalide(new Error('OAuthException: permission retirée')));
});

test('une panne ordinaire n’est pas confondue avec un jeton refusé', () => {
  assert.ok(!jetonInvalide(new Error('HTTP 500 · service indisponible')));
  assert.ok(!jetonInvalide(Object.assign(new Error('limite atteinte'), { code: 4 })), 'restriction : c’est le coupe-circuit qui s’en occupe');
  assert.ok(!jetonInvalide(new DeferError('quota du jour atteint')));
  assert.ok(!jetonInvalide(new GuardError({ title: 't', link: 'l' }, ['titre trop long'])));
  assert.ok(!jetonInvalide(null) && !jetonInvalide(undefined));
});

// Le 23/09, state/jetons.json annonçait encore « 86 jours restants » sur un jeton déjà refusé :
// la surveillance ne lisait que la date d'expiration, jamais la validité.
import { etatMeta } from '../src/measure/jetons.mjs';

const maintenant = Date.parse('2026-09-23T06:32:00Z');
const connu = { meta: { expireLe: '2026-12-16T20:08:59.000Z', restant: 86, renouvellement: 'manuel' } };

test('jeton Meta refusé : annoncé comme tel, plus comme valide 86 jours', () => {
  const refus = { error: { message: 'Error validating access token: The session has been invalidated…', code: 190, error_subcode: 460 } };
  const etat = etatMeta(refus, connu, maintenant);
  assert.equal(etat.invalide, true);
  assert.equal(etat.restant, 0);
  assert.equal(etat.renouvellement, 'à refaire');
  assert.match(etat.message, /session has been invalidated/i);
  assert.equal(etatMeta({ data: { is_valid: false } }, connu, maintenant).invalide, true, 'is_valid false suffit');
});

test('jeton Meta valide : l’échéance est reprise telle quelle', () => {
  const bon = { data: { is_valid: true, data_access_expires_at: Math.floor(Date.parse('2026-12-16T20:08:59Z') / 1000) } };
  const etat = etatMeta(bon, connu, maintenant);
  assert.equal(etat.invalide, undefined);
  assert.equal(etat.restant, 85);
  assert.equal(etatMeta({}, connu, maintenant), null, 'réponse vide : on garde ce qu’on savait');
});
