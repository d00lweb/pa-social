import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evolution, valeurAu, valeurDepuis, resumeSemaine } from '../src/measure/abonnes.mjs';
import { rapportMensuel, messageMensuel, messageHebdo, agreger } from '../src/measure/rapport.mjs';

// Suivi des abonnés, commencé le 18/09/2026 : chaque comparaison part de valeurs réellement relevées,
// jamais inventées ; un jour sans relevé est simplement ignoré.

const releves = {
  '2026-09-18': { instagram: 10146, facebook: 42626, threads: 1144, bluesky: 1 },
  '2026-09-21': { instagram: 10160, facebook: 42600, threads: null, bluesky: 3 },
  '2026-09-25': { instagram: 10200, facebook: 42650, threads: 1170, bluesky: 5 },
};

test('évolution d’un compte entre deux jours', () => {
  assert.deepEqual(evolution(releves, 'instagram', '2026-09-18', '2026-09-25'), { debut: 10146, fin: 10200, gain: 54, pct: 0.5, depuis: '2026-09-18', au: '2026-09-25' });
  assert.equal(evolution(releves, 'facebook', '2026-09-18', '2026-09-21').gain, -26, 'une baisse est montrée telle quelle');
});

test('un jour sans relevé est ignoré, jamais inventé', () => {
  assert.equal(valeurAu(releves, 'threads', '2026-09-22').n, 1144, 'le relevé manquant du 21 est sauté');
  assert.equal(valeurDepuis(releves, 'threads', '2026-09-19').jour, '2026-09-25');
  assert.equal(evolution(releves, 'threads', '2026-09-19', '2026-09-22'), null, 'période sans relevé : rien plutôt qu’un faux chiffre');
  assert.equal(evolution(releves, 'x', '2026-09-18', '2026-09-25'), null, 'X n’est pas suivi');
});

test('semaine : gain des 7 derniers jours, ou depuis le début du suivi', () => {
  const s = resumeSemaine(releves, Date.parse('2026-09-25T12:00:00Z'));
  assert.equal(s.instagram.gain, 54);
  assert.equal(s.instagram.depuis, '2026-09-18', 'moins d’une semaine de suivi : depuis le premier relevé');
  const premierJour = resumeSemaine({ '2026-09-18': releves['2026-09-18'] }, Date.parse('2026-09-18T14:00:00Z'));
  assert.equal(premierJour.facebook.gain, 0);
  assert.equal(premierJour.facebook.depuis, premierJour.facebook.au, 'premier jour : rien à comparer encore');
});

const mesure = (guid, channel, likes, commentaires, publieLe) => ({ guid, channel, jalon: 7, likes, commentaires, partages: 0, publieLe });

test('rapport mensuel : abonnés, engagement et créneaux de chaque réseau', () => {
  const history = [
    { guid: 'a', channel: 'facebook', at: '2026-09-20T06:10:00Z', titre: 'Article A' }, // 8 h 10 à Paris
    { guid: 'b', channel: 'facebook', at: '2026-09-21T18:10:00Z', titre: 'Article B' }, // 20 h 10
    { guid: 'c', channel: 'instagram', at: '2026-09-22T10:05:00Z', titre: 'Article C' }, // 12 h 05
  ];
  const mesures = [mesure('a', 'facebook', 40, 5, history[0].at), mesure('b', 'facebook', 100, 20, history[1].at), mesure('c', 'instagram', 300, 12, history[2].at)];
  const r = rapportMensuel(mesures, history, '2026-09', { releves: { '2026-09-18': { facebook: 42626, instagram: 10146 }, '2026-09-30': { facebook: 42800, instagram: 10300 } } });
  assert.equal(r.abonnes.facebook.gain, 174);
  assert.equal(r.publies.facebook, 2);
  assert.equal(r.interactionsTotal, 477);
  assert.ok(r.engagement.instagram > r.engagement.facebook, 'rapporté aux abonnés, Instagram engage plus');
  assert.deepEqual(Object.keys(r.parCreneauReseau.facebook).sort(), ['20 h – 21 h 30', '8 h – 9 h 30']);
  assert.equal(r.meilleur.titre, 'Article C', 'le titre du meilleur post est retrouvé dans l’historique');
  assert.match(r.conseils.join(' '), /Abonnés/);
  assert.doesNotMatch(r.conseils.join(' '), /heures creuses/, 'plus de conseil obsolète');
  assert.ok(r.conseils.length <= 4, 'quatre conseils au plus');

  const message = messageMensuel(r);
  assert.match(message, /Aucun réglage n’a été modifié/);
  assert.match(message, /Abonnés/);
  assert.ok(message.length < 1500, `court (${message.length} caractères)`);
});

test('premier jour du suivi : aucun conseil sur les abonnés, faute de période à comparer', () => {
  // le 18/09, un rapport disait « Instagram progresse le plus (0, 0 %) » : phrase creuse, supprimée
  const r = rapportMensuel([], [], '2026-09', { releves: { '2026-09-18': { facebook: 42626, instagram: 10146 } } });
  assert.doesNotMatch(r.conseils.join(' '), /Abonnés/);
});

test('message du lundi : les abonnés gagnés dans la semaine', () => {
  const abonnes = resumeSemaine(releves, Date.parse('2026-09-25T12:00:00Z'));
  const texte = messageHebdo(agreger([], {}), { abonnes });
  assert.match(texte, /Abonnés/);
  assert.match(texte, /Instagram \+54/);
});

test('mouvements Facebook : les arrivées et les départs sont relevés à part du solde', async () => {
  const { relevrMouvements } = await import('../src/measure/abonnes.mjs');
  // 25/09/2026 : le solde Facebook baissait de deux par jour. Le détail montre que la page ne
  // perd pas ses abonnés — elle n'en gagne plus : 3 arrivées pour 24 départs sur 30 jours.
  const avant = { FB_PAGE_ID: process.env.FB_PAGE_ID, FB_TOKEN: process.env.FB_TOKEN };
  process.env.FB_PAGE_ID = '123';
  process.env.FB_TOKEN = 'jeton';
  try {
    const lire = async (url) => ({
      data: [{
        values: /follows_unique/.test(url) && !/unfollows/.test(url)
          ? [{ end_time: '2026-09-24T07:00:00+0000', value: 0 }, { end_time: '2026-09-25T07:00:00+0000', value: 2 }]
          : [{ end_time: '2026-09-24T07:00:00+0000', value: 3 }, { end_time: '2026-09-25T07:00:00+0000', value: 1 }],
      }],
    });
    const releves = { '2026-09-24': { facebook: 42614 }, '2026-09-25': { facebook: 42612 } };
    await relevrMouvements(releves, { lire, log: () => {} });
    assert.deepEqual(releves['2026-09-24'].facebookMouvements, { plus: 0, moins: 3 });
    assert.deepEqual(releves['2026-09-25'].facebookMouvements, { plus: 2, moins: 1 });
    assert.equal(releves['2026-09-25'].facebook, 42612, 'le relevé d’abonnés n’est pas touché');

    // un jour absent du suivi n'est pas inventé
    const partiel = { '2026-09-25': { facebook: 42612 } };
    await relevrMouvements(partiel, { lire, log: () => {} });
    assert.equal(partiel['2026-09-24'], undefined);

    // une panne de l'API ne fait pas échouer le relevé
    const casse = { '2026-09-25': { facebook: 1 } };
    await relevrMouvements(casse, { lire: async () => { throw new Error('HTTP 400'); }, log: () => {} });
    assert.equal(casse['2026-09-25'].facebook, 1);
  } finally {
    Object.assign(process.env, avant);
  }
});
