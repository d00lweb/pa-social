import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fromRoot } from '../src/core/config.mjs';
import * as M from '../src/channels/messages.mjs';

// Refonte du 22/11/2026 (« j'en reçois trop, en doublon ; que des messages pertinents ») : trois
// familles, un gabarit. Ces tests tiennent le gabarit : HTML valide, première ligne qui dit tout,
// textes à copier sur des boutons, rien venu d'ailleurs sans échappement.

const BALISES = ['b', 'i', 'u', 's', 'code', 'pre', 'a', 'blockquote'];
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

const titre = 'Un titre & <balise>';
// Tous les messages qui peuvent partir, sur des valeurs piégées
export const exemples = () => [
  ['kit X', M.kitX({ titre, mode: 'reponse', texte: 'Texte <x> & 🎭', longueur: 120, reponse: '📖 L’article : https://site.fr/a', intent: 'https://x.com/intent/post?text=a', comptes: [{ nom: 'Musée', handle: 'musee' }], aChercher: [{ nom: 'Ville & Co', handle: 'ville' }], lieu: 'Bordeaux', alt: 'Une façade' })],
  ['story', M.story({ titre, lienArticle: 'https://site.fr/a', comptes: ['villedebordeaux'], lieu: 'Bordeaux' })],
  ['article pas parti', M.publicationRatee({ titre, lienArticle: 'https://site.fr/a', reseaux: [{ nom: 'Instagram', raison: 'image <404>' }, { nom: 'Threads', raison: 'x & y' }] })],
  ['lien non posté', M.lienNonPoste({ reseau: 'Facebook', titre, texte: '📖 L’article : https://site.fr/a?b=1&c=2', lienPost: 'https://www.facebook.com/p/1' })],
  ['jeton refusé', M.jetonRefuse('meta')],
  ['jeton bientôt fini', M.jetonEcheance('meta', { expireLe: '2026-12-16T00:00:00Z', restant: 12 })],
  ['jeton Threads', M.jetonEcheance('threads', { expireLe: null, restant: 9 })],
  ['pause', M.pauseAuto('Instagram', 'instagram', 'code 368 <restriction>')],
  ['flux', M.flux(3.2, 'Flux RSS 500 : <https://site/feed/>')],
  ['plus de crédit', M.ia('400 credit balance is too low', { manqueDeCredit: true })],
  ['IA injoignable', M.ia('fetch failed <socket>', { manqueDeCredit: false })],
  ['budget', M.budget({ depense: 6.4, budget: 6 }, { couperAuPlafond: false })],
  ['budget, coupure', M.budget({ depense: 6.4, budget: 6 }, { couperAuPlafond: true })],
  ['Facebook invisible', M.facebookInvisible(5)],
  ['passage', M.passageEnEchec('TypeError: x <y>')],
  ['réglé', M.messageRegle('Le flux du site répond de nouveau.')],
  ['rappel', M.rappel(M.flux(5, 'panne'), '2026-11-20T10:00:00Z')],
];

test('chaque message est du HTML valide pour Telegram', () => {
  for (const [nom, m] of exemples()) assert.equal(baliseInvalide(m.text), null, `${nom} : ${baliseInvalide(m.text)}`);
});

test('première ligne : un pictogramme par famille, ce qu’il faut savoir en gras', () => {
  for (const [nom, m] of exemples()) {
    const tete = m.text.split('\n')[0];
    assert.match(tete, /^(📌|⚠️|✅) <b>[^<]+<\/b>/, `${nom} : « ${tete} »`);
  }
  assert.match(M.kitX({ titre: 'T', texte: 'x', longueur: 1 }).text, /^📌 /, 'À faire');
  assert.match(M.flux(4, 'x').text, /^⚠️ /, 'Problème');
  assert.match(M.messageRegle('ok').text, /^✅ <b>Réglé<\/b> · ok$/, 'Réglé');
  assert.match(M.rappel(M.flux(4, 'x'), '2026-11-20T10:00:00Z').text, /^⚠️ <b>Rappel<\/b>, depuis le 20 novembre · <b>Flux du site injoignable<\/b>/);
});

test('tout ce qui vient d’ailleurs est échappé', () => {
  for (const [nom, m] of exemples()) assert.doesNotMatch(m.text, /<balise>|<socket>|<restriction>|<x>|<404>|<y>/, `${nom} : texte venu d’ailleurs non échappé`);
  assert.match(M.publicationRatee({ titre, reseaux: [{ nom: 'Instagram', raison: 'r' }] }).text, /Un titre &amp; &lt;balise&gt;/);
  assert.equal(M.esc('a & b < c > d'), 'a &amp; b &lt; c &gt; d');
});

test('un texte à copier est sur un bouton, et le bouton copie la valeur exacte', () => {
  const b = M.copie('Texte', '  Une accroche 🎭  ');
  assert.deepEqual(b, { text: '📋 Texte', copy_text: { text: 'Une accroche 🎭' } }, 'sans blanc de bordure, sans étiquette');
  assert.ok(M.copie('x', 'a'.repeat(M.COPIE_MAX)), `${M.COPIE_MAX} caractères : bouton`);
  assert.equal(M.copie('x', 'a'.repeat(M.COPIE_MAX + 1)), null, 'au-delà, pas de bouton : Telegram le refuserait');
  assert.equal(M.lien('Ouvrir', 'javascript:alert(1)'), null, 'un lien n’est jamais autre chose qu’une adresse https');
  const lienNonPoste = M.lienNonPoste({ reseau: 'Threads', titre: 'T', texte: 'Le lien : https://site.fr/a', lienPost: 'https://www.threads.com/@lovaquitaine/post/1' });
  const boutons = JSON.parse(lienNonPoste.reply_markup).inline_keyboard.flat();
  assert.equal(boutons[0].url, 'https://www.threads.com/@lovaquitaine/post/1', 'le lien direct vers la publication');
  assert.equal(boutons[1].copy_text.text, 'Le lien : https://site.fr/a', 'le texte à coller, d’un geste');
});

test('article pas parti : un message pour tous les réseaux, et la phrase pour Claude', () => {
  const m = M.publicationRatee({ titre: 'T', lienArticle: 'https://site.fr/a', reseaux: [{ nom: 'Instagram', raison: 'a' }, { nom: 'Threads', raison: 'b' }, { nom: 'Bluesky', raison: 'c' }] });
  assert.match(m.text, /^⚠️ <b>Pas parti sur Instagram, Threads et Bluesky<\/b> · T/);
  assert.equal((m.text.match(/^• /gm) ?? []).length, 3, 'une ligne par réseau');
  assert.match(m.text, /Relance l’article bloqué sur les réseaux sociaux/);
  assert.equal(M.raisonCourte(new Error('Image 404 : https://site.fr/x.jpg')), 'l’image de l’article ne répond plus sur le site');
  assert.equal(M.raisonCourte({ message: 'x', problems: ['titre trop long'] }), 'titre trop long');
  assert.equal(M.raisonCourte(new Error('Invalid OAuth access token')), 'jeton refusé par le réseau');
});

test('aucune statistique ni compte rendu de publication', () => {
  const tout = exemples().map(([, m]) => m.text).join('\n');
  assert.doesNotMatch(tout, /Publié sur|Bilan|interactions|abonnés|Point conso|lieux? appris/i);
  assert.equal(M.messagePublie, undefined, 'le « Publié sur … » n’existe plus');
});

test('le catalogue couvre tous les envois du code', () => {
  // Garde-fou : un module qui envoie sur Telegram (directement, ou par les problèmes et les messages
  // uniques) doit figurer au catalogue, sinon la vue d'ensemble ment.
  const fichiers = [];
  const parcourir = (dir) => {
    for (const e of readdirSync(fromRoot(dir), { withFileTypes: true })) {
      if (e.isDirectory()) parcourir(`${dir}/${e.name}`);
      else if (e.name.endsWith('.mjs')) fichiers.push(`${dir}/${e.name}`.replace(/^src\//, ''));
    }
  };
  parcourir('src');
  const horsSujet = ['channels/telegram.mjs', 'channels/messages.mjs', 'channels/problemes.mjs'];
  const envoyeurs = fichiers.filter((f) => {
    if (horsSujet.includes(f)) return false;
    const code = readFileSync(fromRoot('src', f), 'utf8');
    return /\b(send|alert|sendPhotos|sendDocument|envoyerMessage|editText|signaler|unSeul)\s*\(/.test(code) && /telegram\.mjs|messages\.mjs|problemes\.mjs/.test(code);
  });
  const couverts = new Set(M.CATALOGUE.flatMap((m) => m.module.split(/,\s*/)));
  for (const f of envoyeurs) assert.ok(couverts.has(f), `${f} envoie sur Telegram mais n’est pas au catalogue`);
  for (const m of M.CATALOGUE) assert.ok(m.id && m.titre && m.quand && m.frequence, `${m.id} : entrée incomplète`);
});
