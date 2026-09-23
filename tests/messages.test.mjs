import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fromRoot } from '../src/core/config.mjs';
import { aCopier, esc, COPIE_MAX, CATALOGUE, alerteBudget, alerteIa, alerteJeton, alerteJetonRefuse, alerteThreadsReponse } from '../src/channels/messages.mjs';

// 23/09/2026, retours d'usage : des messages arrivaient avec « <b> » affiché en clair, et copier
// un texte à publier ramenait son titre (« 📝 Texte du post »), qu'il fallait effacer dans X — la
// ligne vide laissée derrière faisait commencer le post par un saut de ligne.

const BALISES = ['b', 'i', 'u', 's', 'code', 'pre', 'a', 'blockquote'];

// Balisage valide : uniquement les balises acceptées par Telegram, et chacune refermée.
function baliseInvalide(texte) {
  const ouvertes = [];
  for (const m of String(texte).matchAll(/<(\/?)([a-z]+)(?:\s[^>]*)?>/g)) {
    const [, fermante, nom] = m;
    if (!BALISES.includes(nom)) return `balise inconnue : ${nom}`;
    if (fermante) {
      if (ouvertes.pop() !== nom) return `fermeture inattendue : ${nom}`;
    } else ouvertes.push(nom);
  }
  return ouvertes.length ? `balise non fermée : ${ouvertes.join(', ')}` : null;
}

const exemples = () => [
  ['budget 70 %', alerteBudget({ depense: 4.2, budget: 6, part: 0.7, depasse: false }, { couperAuPlafond: false })],
  ['budget dépassé', alerteBudget({ depense: 6.4, budget: 6, part: 1.07, depasse: true }, { couperAuPlafond: false })],
  ['budget dépassé, coupure', alerteBudget({ depense: 6.4, budget: 6, part: 1.07, depasse: true }, { couperAuPlafond: true })],
  ['plus de crédit', alerteIa('400 credit balance is too low', { manqueDeCredit: true })],
  ['IA injoignable', alerteIa('fetch failed <socket>', { manqueDeCredit: false })],
  ['jeton Meta', alerteJeton('meta', { expireLe: Date.parse('2026-12-01'), restant: 12 })],
  ['jeton Threads', alerteJeton('threads', { restant: 9 })],
  ['jeton refusé', alerteJetonRefuse('Facebook & Instagram', 'code 190 <sous-code 460>')],
  ['réponse Threads', alerteThreadsReponse('Un titre & <balise>', '📖 https://site.fr/a')],
];

test('chaque message est du HTML valide pour Telegram', () => {
  for (const [nom, texte] of exemples()) {
    assert.equal(baliseInvalide(texte), null, `${nom} : ${baliseInvalide(texte)}`);
  }
});

test('tout ce qui vient d’ailleurs est échappé', () => {
  // un titre d'article ou un message d'erreur contenant « & » ou « < » ferait échouer l'envoi entier
  assert.match(alerteIa('fetch failed <socket>', { manqueDeCredit: false }), /&lt;socket&gt;/);
  assert.match(alerteJetonRefuse('Facebook & Instagram', 'x'), /Facebook &amp; Instagram/);
  assert.match(alerteThreadsReponse('Un titre & <balise>', 'x'), /Un titre &amp; &lt;balise&gt;/);
  assert.equal(esc('a & b < c > d'), 'a &amp; b &lt; c &gt; d');
});

test('un message à copier ne contient que ce qu’il faut copier', () => {
  const { text, options } = aCopier('Copier le texte du post', '  Une accroche 🎭  ');
  assert.equal(text, '<code>Une accroche 🎭</code>', 'ni étiquette, ni emoji de titre, ni compteur');
  assert.doesNotMatch(text, /Copier|Texte du post/, 'l’étiquette reste sur le bouton');
  const bouton = JSON.parse(options.reply_markup).inline_keyboard[0][0];
  assert.equal(bouton.text, '📋 Copier le texte du post');
  assert.equal(bouton.copy_text.text, 'Une accroche 🎭', 'le bouton copie la valeur nettoyée, sans blanc de bordure');
});

test('au-delà de la limite Telegram, le bouton disparaît mais le message reste copiable', () => {
  const court = aCopier('x', 'a'.repeat(COPIE_MAX));
  const long = aCopier('x', 'a'.repeat(COPIE_MAX + 1));
  assert.ok(court.options.reply_markup, `${COPIE_MAX} caractères : bouton`);
  assert.equal(long.options.reply_markup, undefined, 'au-delà : pas de bouton, Telegram le refuserait');
  assert.match(long.text, /^<code>a+<\/code>$/, 'le message reste la valeur seule');
});

test('une note reste hors du texte copié', () => {
  const { text, options } = aCopier('Copier le lieu', 'Musée d’Aquitaine', { note: 'S’il n’apparaît pas : Bordeaux' });
  assert.match(text, /^<code>Musée d’Aquitaine<\/code>\n<i>/, 'la note vient après, en italique');
  assert.equal(JSON.parse(options.reply_markup).inline_keyboard[0][0].copy_text.text, 'Musée d’Aquitaine');
});

test('le catalogue couvre tous les envois du code', () => {
  // Garde-fou : un module qui envoie sur Telegram doit figurer au catalogue, sinon la vue
  // d'ensemble ment. Les scripts d'essai et le module Telegram lui-même sont hors sujet.
  const fichiers = [];
  const parcourir = (dir) => {
    for (const e of readdirSync(fromRoot(dir), { withFileTypes: true })) {
      if (e.isDirectory()) parcourir(`${dir}/${e.name}`);
      else if (e.name.endsWith('.mjs')) fichiers.push(`${dir}/${e.name}`.replace(/^src\//, ''));
    }
  };
  parcourir('src');
  const envoyeurs = fichiers.filter((f) => {
    if (f === 'channels/telegram.mjs' || f === 'channels/messages.mjs') return false;
    const code = readFileSync(fromRoot('src', f), 'utf8');
    return /\b(send|sendCopie|alert|sendStory|sendPhotos|sendDocument)\s*\(/.test(code) && /telegram\.mjs|messages\.mjs/.test(code);
  });
  const couverts = new Set(CATALOGUE.map((m) => m.module));
  for (const f of envoyeurs) assert.ok(couverts.has(f), `${f} envoie sur Telegram mais n’est pas au catalogue`);
  for (const m of CATALOGUE) {
    assert.ok(m.id && m.titre && m.quand && m.frequence, `${m.id} : entrée incomplète`);
  }
});

test('publication : le lien direct est dans un bouton, pas dans le texte', async () => {
  const { messagePublie } = await import('../src/channels/messages.mjs');
  const { text, options } = messagePublie('Instagram', 'Un titre & <balise>', 'https://www.instagram.com/p/Abc/');
  assert.equal(text, '📣 <b>Publié sur Instagram</b>\nUn titre &amp; &lt;balise&gt;');
  const bouton = JSON.parse(options.reply_markup).inline_keyboard[0][0];
  assert.equal(bouton.text, '👁️ Voir sur Instagram');
  assert.equal(bouton.url, 'https://www.instagram.com/p/Abc/');
  // lien pas encore connu : le message part quand même, sans bouton mort
  assert.deepEqual(messagePublie('Bluesky', 'T', null).options, {});
});
