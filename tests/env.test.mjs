import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remplacerVariables } from '../scripts/meta-page.mjs';

// Écrire un nouveau jeton dans .env ne doit rien abîmer d'autre : ni l'ordre, ni les commentaires,
// ni les autres valeurs — un .env cassé, et toutes les exécutions échouent.

const env = [
  '# Meta',
  'IG_USER_ID=17841400000000000',
  'IG_TOKEN=ancien-ig',
  'FB_PAGE_ID=227437307428711',
  'FB_TOKEN=ancien-fb',
  '',
  '# Telegram',
  'TELEGRAM_CHAT_ID=42',
].join('\n');

test('le jeton est remplacé, le reste du fichier est intact', () => {
  const sortie = remplacerVariables(env, { FB_TOKEN: 'NOUVEAU', IG_TOKEN: 'NOUVEAU' });
  assert.equal(sortie, [
    '# Meta',
    'IG_USER_ID=17841400000000000',
    'IG_TOKEN=NOUVEAU',
    'FB_PAGE_ID=227437307428711',
    'FB_TOKEN=NOUVEAU',
    '',
    '# Telegram',
    'TELEGRAM_CHAT_ID=42',
  ].join('\n'));
});

test('une variable absente est ajoutée, les fins de ligne Windows sont conservées', () => {
  const sortie = remplacerVariables('IG_USER_ID=1\r\nFB_PAGE_ID=2', { FB_TOKEN: 'X', IG_TOKEN: 'X' });
  assert.equal(sortie, 'IG_USER_ID=1\r\nFB_PAGE_ID=2\r\nFB_TOKEN=X\r\nIG_TOKEN=X');
});

test('une variable au nom voisin n’est pas touchée', () => {
  const sortie = remplacerVariables('FB_TOKEN_OLD=garde-moi\nFB_TOKEN=change-moi', { FB_TOKEN: 'X' });
  assert.equal(sortie, 'FB_TOKEN_OLD=garde-moi\nFB_TOKEN=X');
});
