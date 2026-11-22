import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reinitialiser, unSeul, signaler, regler, distribuer, ouverts, ajouterCause, retirerCause, etatDesProblemes, RAPPEL_JOURS } from '../src/channels/problemes.mjs';
import { flux, messageRegle, publicationRatee } from '../src/channels/messages.mjs';

// 22/11/2026 : « j'en reçois trop, en doublon ». Un message unique ne part qu'une fois ; un problème
// part une fois, un rappel par semaine au plus, puis « réglé » ; rien la nuit.
const paris = (s) => Date.parse(`${s}+01:00`);
const JOUR = 86400e3;
const silence = () => {};
const boite = () => {
  const envoyes = [], corriges = [];
  let n = 100;
  return {
    envoyes, corriges,
    envoyer: async (m) => { envoyes.push(m.text); return { message_id: n++ }; },
    editer: async (id, m) => { corriges.push([id, m.text]); },
  };
};

test('anti-doublon : un même message (même clé, même article) ne part qu’une fois', async () => {
  reinitialiser();
  let envois = 0;
  const kit = () => { envois++; return Promise.resolve(); };
  const journal = console.log;
  console.log = silence;
  try {
    assert.equal(await unSeul('kit-x:article-1', kit), true);
    assert.equal(await unSeul('kit-x:article-1', kit), false, 'deuxième passage, nouvel essai, passage qui se chevauche : rien ne repart');
    assert.equal(await unSeul('story:article-1', kit), true, 'une autre clé, un autre message');
    assert.equal(await unSeul('kit-x:article-2', kit), true);
  } finally {
    console.log = journal;
  }
  assert.equal(envois, 3);
  // un envoi qui échoue n'est pas noté : il repartira, une seule fois
  await assert.rejects(unSeul('kit-x:article-3', () => Promise.reject(new Error('Telegram 502'))));
  assert.equal(await unSeul('kit-x:article-3', kit), true);
});

test('problème : un message, pas un par passage, puis « réglé » une fois', async () => {
  reinitialiser();
  const b = boite();
  const t0 = paris('2026-11-23T10:00:00');
  // le flux tombe : chaque passage (toutes les 20 min) le constate
  for (let i = 0; i < 9; i++) {
    await signaler('flux', { type: 'flux-indisponible', message: flux(3 + i / 3, 'HTTP 500'), maintenant: t0 + i * 20 * 60e3 });
    await distribuer({ maintenant: t0 + i * 20 * 60e3, envoyer: b.envoyer, log: silence });
  }
  assert.equal(b.envoyes.length, 1, 'neuf passages, un seul message');
  assert.match(b.envoyes[0], /^⚠️ <b>Flux du site injoignable<\/b>/);
  // le flux revient : un « réglé », et plus rien ensuite
  assert.equal(await regler('flux', { message: messageRegle('Le flux du site répond de nouveau.') }), true);
  assert.equal(await regler('flux', { message: messageRegle('Le flux du site répond de nouveau.') }), false, 'déjà réglé');
  await distribuer({ maintenant: t0 + 4 * 3600e3, envoyer: b.envoyer, log: silence });
  await distribuer({ maintenant: t0 + 5 * 3600e3, envoyer: b.envoyer, log: silence });
  assert.equal(b.envoyes.length, 2);
  assert.match(b.envoyes[1], /^✅ <b>Réglé<\/b> · Le flux/);
  assert.deepEqual(await ouverts(), []);
});

test('problème qui dure : un rappel par semaine au plus', async () => {
  reinitialiser();
  const b = boite();
  const t0 = paris('2026-11-23T10:00:00');
  for (let jour = 0; jour <= 15; jour++) {
    const t = t0 + jour * JOUR;
    await signaler('budget', { type: 'budget', message: flux(1, 'x'), delaiMinutes: 0, maintenant: t });
    await distribuer({ maintenant: t, envoyer: b.envoyer, log: silence });
  }
  assert.equal(b.envoyes.length, 3, `jour 0, jour ${RAPPEL_JOURS}, jour ${2 * RAPPEL_JOURS}`);
  assert.match(b.envoyes[1], /^⚠️ <b>Rappel<\/b>, depuis le 23 novembre/);
});

test('problème réglé avant d’avoir été annoncé : rien ne part', async () => {
  reinitialiser();
  const b = boite();
  // signalé en pleine nuit : attend le matin ; réglé avant : ni problème ni « réglé »
  await signaler('flux', { type: 'flux-indisponible', message: flux(3, 'x'), maintenant: paris('2026-11-24T02:00:00') });
  await distribuer({ maintenant: paris('2026-11-24T02:00:00'), envoyer: b.envoyer, log: silence });
  assert.equal(b.envoyes.length, 0, 'rien la nuit');
  await regler('flux', { message: messageRegle('ok') });
  await distribuer({ maintenant: paris('2026-11-24T08:20:00'), envoyer: b.envoyer, log: silence });
  assert.equal(b.envoyes.length, 0);
});

test('la nuit, rien ne part ; au matin, le problème part une fois', async () => {
  reinitialiser();
  const b = boite();
  await signaler('ia', { type: 'ia-indisponible', message: flux(3, 'x'), maintenant: paris('2026-11-24T23:10:00') });
  for (const h of ['23:10', '23:20']) await distribuer({ maintenant: paris(`2026-11-24T${h}:00`), envoyer: b.envoyer, log: silence });
  for (const h of ['03:00', '07:40']) await distribuer({ maintenant: paris(`2026-11-25T${h}:00`), envoyer: b.envoyer, log: silence });
  assert.equal(b.envoyes.length, 0);
  await distribuer({ maintenant: paris('2026-11-25T08:00:00'), envoyer: b.envoyer, log: silence });
  await distribuer({ maintenant: paris('2026-11-25T08:20:00'), envoyer: b.envoyer, log: silence });
  assert.equal(b.envoyes.length, 1);
});

test('article pas parti sur plusieurs réseaux : un message, complété en place', async () => {
  reinitialiser();
  const b = boite();
  const t = paris('2026-11-24T12:00:00');
  const r1 = [{ nom: 'Instagram', raison: 'image introuvable' }];
  await signaler('ratee:g', { type: 'publication-ratee', rappel: false, editable: true, dureeJours: 7, message: publicationRatee({ titre: 'T', lienArticle: 'https://site.fr/a', reseaux: r1 }), maintenant: t });
  await distribuer({ maintenant: t, envoyer: b.envoyer, editer: b.editer, log: silence });
  const r2 = [...r1, { nom: 'Threads', raison: 'image introuvable' }];
  await signaler('ratee:g', { type: 'publication-ratee', rappel: false, editable: true, dureeJours: 7, message: publicationRatee({ titre: 'T', lienArticle: 'https://site.fr/a', reseaux: r2 }), maintenant: t + 3600e3 });
  await distribuer({ maintenant: t + 3600e3, envoyer: b.envoyer, editer: b.editer, log: silence });
  await distribuer({ maintenant: t + 9 * JOUR, envoyer: b.envoyer, editer: b.editer, log: silence });
  assert.equal(b.envoyes.length, 1, 'un seul message pour l’article, jamais de rappel');
  assert.equal(b.corriges.length, 1, 'le second réseau corrige le message déjà envoyé');
  assert.match(b.corriges[0][1], /Pas parti sur Instagram et Threads/);
  assert.deepEqual(await ouverts('ratee:'), [], 'un fait ponctuel se clôt seul');
});

test('un message coupé dans les réglages ne part pas, et ne part pas plus tard', async () => {
  const catalogue = (await import('../src/channels/messages.mjs')).CATALOGUE;
  const budget = catalogue.find((m) => m.id === 'budget');
  const avant = budget.actif;
  budget.actif = false;
  try {
    reinitialiser();
    const b = boite();
    await signaler('budget', { type: 'budget', message: flux(1, 'x'), delaiMinutes: 0, maintenant: paris('2026-11-24T10:00:00') });
    await distribuer({ maintenant: paris('2026-11-24T10:00:00'), envoyer: b.envoyer, log: silence });
    budget.actif = true;
    await distribuer({ maintenant: paris('2026-11-25T10:00:00'), envoyer: b.envoyer, log: silence });
    assert.equal(b.envoyes.length, 0);
  } finally {
    budget.actif = avant;
  }
});

test('un envoi raté reste dû : il repart au passage suivant, une fois', async () => {
  reinitialiser();
  const b = boite();
  let panne = true;
  const envoyer = async (m) => { if (panne) throw new Error('Telegram 502'); return b.envoyer(m); };
  const t = paris('2026-11-24T10:00:00');
  await signaler('jeton:meta', { type: 'jeton', message: flux(1, 'x'), maintenant: t });
  await distribuer({ maintenant: t, envoyer, log: silence });
  panne = false;
  await distribuer({ maintenant: t + 20 * 60e3, envoyer, log: silence });
  await distribuer({ maintenant: t + 40 * 60e3, envoyer, log: silence });
  assert.equal(b.envoyes.length, 1);
});

test('incident d’un seul passage : rien ne part, ni le problème ni « réglé »', async () => {
  reinitialiser();
  const b = boite();
  const t = paris('2026-11-24T10:00:00');
  await signaler('ia', { type: 'ia-indisponible', message: flux(1, 'appel raté'), maintenant: t });
  await distribuer({ maintenant: t, envoyer: b.envoyer, log: silence });
  await regler('ia', { message: messageRegle('ok') });
  await distribuer({ maintenant: t + 20 * 60e3, envoyer: b.envoyer, log: silence });
  assert.equal(b.envoyes.length, 0);
});

test('problème rouvert avant que son « réglé » parte : ni « réglé », ni nouveau message', async () => {
  reinitialiser();
  const b = boite();
  const t = paris('2026-11-24T10:00:00');
  await signaler('flux', { type: 'flux-indisponible', message: flux(3, 'x'), delaiMinutes: 0, maintenant: t });
  await distribuer({ maintenant: t, envoyer: b.envoyer, log: silence });
  await regler('flux', { message: messageRegle('ok') });
  await signaler('flux', { type: 'flux-indisponible', message: flux(3, 'x'), delaiMinutes: 0, maintenant: t + 60e3 });
  await distribuer({ maintenant: t + 20 * 60e3, envoyer: b.envoyer, log: silence });
  assert.equal(b.envoyes.length, 1, 'seulement la première annonce');
});

test('jeton refusé sur deux réseaux et à la vérification : un message, « réglé » quand tout repart', async () => {
  reinitialiser();
  const b = boite();
  const t = paris('2026-11-24T10:00:00');
  const opts = { type: 'jeton', message: flux(1, 'jeton'), delaiMinutes: 0, maintenant: t };
  await ajouterCause('jeton:meta', 'instagram', opts);
  await ajouterCause('jeton:meta', 'facebook', opts);
  await ajouterCause('jeton:meta', 'verification', opts);
  await distribuer({ maintenant: t, envoyer: b.envoyer, log: silence });
  await retirerCause('jeton:meta', 'instagram', { message: messageRegle('Jeton Meta : les publications reprennent.') });
  await retirerCause('jeton:meta', 'verification', { message: messageRegle('Jeton Meta : les publications reprennent.') });
  await distribuer({ maintenant: t + 3600e3, envoyer: b.envoyer, log: silence });
  assert.equal(b.envoyes.length, 1, 'Facebook est toujours refusé : pas encore réglé');
  await retirerCause('jeton:meta', 'facebook', { message: messageRegle('Jeton Meta : les publications reprennent.') });
  await distribuer({ maintenant: t + 2 * 3600e3, envoyer: b.envoyer, log: silence });
  assert.equal(b.envoyes.length, 2);
  assert.match(b.envoyes[1], /^✅ <b>Réglé<\/b> · Jeton Meta/);
});

test('un second réseau en échec des heures plus tard : un nouveau message, pas une correction muette', async () => {
  reinitialiser();
  const b = boite();
  const t = paris('2026-11-24T08:10:00');
  const ratee = (reseaux) => ({ type: 'publication-ratee', rappel: false, editable: true, dureeJours: 7, message: publicationRatee({ titre: 'T', reseaux }) });
  await signaler('ratee:g', { ...ratee([{ nom: 'Threads', raison: 'r' }]), maintenant: t });
  await distribuer({ maintenant: t, envoyer: b.envoyer, editer: b.editer, log: silence });
  await signaler('ratee:g', { ...ratee([{ nom: 'Threads', raison: 'r' }, { nom: 'Instagram', raison: 'r' }]), maintenant: t + 5 * 3600e3 });
  await distribuer({ maintenant: t + 5 * 3600e3, envoyer: b.envoyer, editer: b.editer, log: silence });
  assert.equal(b.corriges.length, 0);
  assert.equal(b.envoyes.length, 2);
  assert.match(b.envoyes[1], /Pas parti sur Threads et Instagram/);
});

test('rien de ce qui est gardé ne contient un jeton recopié par un réseau', async () => {
  reinitialiser();
  await signaler('passage', { type: 'passage-en-echec', message: { text: 'Invalid OAuth access token EAAGm0PX4ZCpsBOZBZCZBqwertyuiopasdfghjklzxcvbnm1234567890' }, maintenant: Date.now() });
  assert.doesNotMatch(JSON.stringify(await etatDesProblemes()), /EAAGm0PX4ZC/);
});
