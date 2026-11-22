import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOGUE, notificationActive } from '../src/channels/messages.mjs';
import { etatMeta, etatThreads, facebookSansVue } from '../src/measure/jetons.mjs';
import { porteeInstagram, porteeFacebook, completerPortee } from '../src/measure/collect.mjs';

// 22/11/2026 : les messages Telegram se règlent depuis le dashboard (config/notifications.json).
// Ce fichier part en production à chaque enregistrement : ces tests refusent un fichier incomplet
// ou un livrable devenu réglable, mais jamais un simple interrupteur coupé.

test('notifications : le fichier est complet et sans doublon', () => {
  const ids = CATALOGUE.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, 'un identifiant par message');
  for (const m of CATALOGUE) {
    assert.ok(m.id && m.titre && m.quand && m.frequence && m.module, `${m.id} : entrée incomplète`);
    assert.ok(['livrable', 'suivi', 'alerte', 'reponse'].includes(m.famille), `${m.id} : famille inconnue`);
    assert.equal(typeof m.reglable, 'boolean', `${m.id} : reglable doit être vrai ou faux`);
    assert.equal(typeof m.actif, 'boolean', `${m.id} : actif doit être vrai ou faux`);
  }
});

test('notifications : ce qui ne doit jamais se couper n’est pas réglable', () => {
  for (const id of ['kit-x', 'threads-reponse', 'commandes', 'pause-auto']) {
    assert.equal(CATALOGUE.find((m) => m.id === id)?.reglable, false, `${id} doit toujours partir`);
  }
});

test('notifications : un message coupé ne part pas, un livrable part toujours', () => {
  const catalogue = [
    { id: 'publication', reglable: true, actif: false },
    { id: 'bilan-hebdo', reglable: true, actif: true },
    { id: 'kit-x', reglable: false, actif: false },
  ];
  assert.equal(notificationActive('publication', catalogue), false);
  assert.equal(notificationActive('bilan-hebdo', catalogue), true);
  assert.equal(notificationActive('kit-x', catalogue), true, 'non réglable : part même noté coupé');
  assert.equal(notificationActive('inconnu', catalogue), true, 'un message absent du fichier part');
});

// Jetons : l'état affiché doit être vrai. Le 22/11/2026, il annonçait « 86 jours, échéance au
// 16/12 » pour un jeton Meta sans échéance, et « expiré depuis 5 jours » pour un jeton Threads
// prolongé le 16/11 et valable jusqu'au 15/01/2027.
const maintenant = Date.parse('2026-11-22T03:00:00Z');
const connu = {
  meta: { expireLe: '2026-12-16T20:08:59.000Z', restant: 86, renouvellement: 'manuel' },
  threads: { expireLe: '2026-11-16T21:12:39.531Z', restant: -5 },
};

test('jeton Meta sans échéance : dit comme tel, avec ses droits', () => {
  const etat = etatMeta({ data: { is_valid: true, type: 'PAGE', expires_at: 0, data_access_expires_at: 0, issued_at: 1790000000, scopes: ['read_insights', 'pages_manage_posts'] } }, connu, maintenant);
  assert.equal(etat.expireLe, null);
  assert.equal(etat.restant, null);
  assert.equal(etat.renouvellement, 'aucun');
  assert.equal(etat.valide, true);
  assert.equal(etat.type, 'PAGE');
  assert.deepEqual(etat.droits, ['read_insights', 'pages_manage_posts']);
});

test('jeton Threads : l’échéance vient de Threads, pas d’une date gardée', () => {
  const fin = Math.floor(Date.parse('2027-01-15T13:45:00Z') / 1000);
  const etat = etatThreads({ data: { is_valid: true, type: 'USER', expires_at: fin, scopes: ['threads_basic'] } }, connu, maintenant);
  assert.equal(etat.expireLe, '2027-01-15T13:45:00.000Z');
  assert.equal(etat.restant, 54);
  assert.equal(etat.renouvellement, 'automatique');
  assert.equal(etatThreads({ data: { is_valid: false } }, connu, maintenant).invalide, true);
});

test('la plus proche des deux échéances fait foi', () => {
  const proche = Math.floor(Date.parse('2026-12-02T03:00:00Z') / 1000);
  const loin = Math.floor(Date.parse('2027-03-01T03:00:00Z') / 1000);
  assert.equal(etatMeta({ data: { is_valid: true, expires_at: loin, data_access_expires_at: proche } }, connu, maintenant).restant, 10);
});

// Facebook : 88 publications à 0 vue pendant deux mois, sans que rien ne le signale.
const releve = (guid, jour, vues, jalon = 7) => ({ guid, channel: 'facebook', jalon, publieLe: `2026-11-${jour}T08:00:00Z`, vues });

test('Facebook sans aucune vue : signalé quand cinq publications mesurées sont à zéro', () => {
  const zero = ['10', '11', '12', '13', '14'].map((j) => releve(`g${j}`, j, 0));
  assert.deepEqual(facebookSansVue(zero), { publications: 5, vues: 0, invisible: true, depuis: '2026-11-10T08:00:00Z' });
  assert.equal(facebookSansVue([...zero.slice(1), releve('g15', '15', 412)]).invisible, false, 'une publication vue suffit');
  assert.equal(facebookSansVue(zero.slice(0, 4)), null, 'moins de cinq relevés : on ne conclut pas');
  assert.equal(facebookSansVue(zero.map((m) => ({ ...m, vues: null }))), null, 'sans vues relevées, aucun verdict');
  assert.equal(facebookSansVue([...zero, { ...releve('i1', '16', 300), channel: 'instagram' }]).invisible, true, 'seul Facebook compte');
});

test('portée : les mesures de Meta sont traduites, les absentes laissées de côté', () => {
  const ig = { data: [{ name: 'reach', values: [{ value: 328 }] }, { name: 'views', values: [{ value: 599 }] }, { name: 'saved', values: [{ value: 1 }] }, { name: 'shares', values: [{ value: 0 }] }] };
  assert.deepEqual(porteeInstagram(ig), { vues: 599, portee: 328, enregistrements: 1, envois: 0 }, 'les envois restent hors du total des interactions');
  const fb = { data: [{ name: 'post_media_view', values: [{ value: 856 }] }, { name: 'post_total_media_view_unique', values: [{ value: 517 }] }, { name: 'post_clicks', values: [{ value: 17 }] }] };
  assert.deepEqual(porteeFacebook(fb), { vues: 856, portee: 517, clics: 17 });
  assert.deepEqual(porteeFacebook({ data: [] }), {}, 'rien de lisible : rien d’écrit, les likes restent');
});

test('portée après coup : les relevés anciens sont complétés, deux essais au plus', async () => {
  const mesures = [
    { guid: 'a', channel: 'instagram', mediaId: '1', publieLe: '2026-11-01T10:00:00Z', jalon: 7, likes: 4, vues: null },
    { guid: 'b', channel: 'facebook', mediaId: '2', publieLe: '2026-11-02T10:00:00Z', jalon: 7, likes: 0, vues: null },
    { guid: 'c', channel: 'threads', mediaId: '3', publieLe: '2026-11-03T10:00:00Z', jalon: 7, vues: 120 },
    { guid: 'd', channel: 'facebook', publieLe: '2026-11-04T10:00:00Z', jalon: 7, introuvable: true },
  ];
  const lire = {
    instagram: async () => ({ vues: 599, portee: 328 }),
    facebook: async () => { throw new Error('post supprimé'); },
  };
  assert.equal(await completerPortee(mesures, { lire }), 2, 'Threads a déjà ses vues, l’introuvable est laissé');
  assert.equal(mesures[0].vues, 599);
  assert.equal(mesures[0].porteeApresCoup, true);
  assert.equal(mesures[0].likes, 4, 'les likes relevés ne bougent pas');
  assert.equal(mesures[1].porteeEssais, 1);
  await completerPortee(mesures, { lire });
  assert.equal(await completerPortee(mesures, { lire }), 0, 'après deux échecs, on n’insiste plus');
});

test('un jeton recopié dans un message d’erreur n’est jamais gardé', async () => {
  const { sansSecret } = await import('../src/core/errors.mjs');
  assert.equal(sansSecret('Malformed access token EAAGm0PX4ZCpsBOZBZCZBqwertyuiopasdfghjklzxcvbnm1234567890'), 'Malformed access token […]');
  assert.equal(sansSecret('Image 404 : https://site.fr/wp-content/uploads/2026/11/tete-dauphin.jpg'), 'Image 404 : https://site.fr/wp-content/uploads/2026/11/tete-dauphin.jpg', 'une adresse d’article reste lisible');
});

test('jeton refusé : l’alerte ne donne pas de date inventée', async () => {
  const { alerteJeton } = await import('../src/channels/messages.mjs');
  const texte = alerteJeton('meta', { expireLe: null, restant: 0, invalide: true });
  assert.match(texte, /Jeton Meta \(Facebook \+ Instagram\) refusé/);
  assert.doesNotMatch(texte, /1970/);
});

test('les alertes de jeton et de visibilité ne partent pas la nuit', async () => {
  const { heureDAlerte } = await import('../src/measure/jetons.mjs');
  assert.equal(heureDAlerte(Date.parse('2026-11-22T03:00:00Z')), false, '4 h à Paris');
  assert.equal(heureDAlerte(Date.parse('2026-11-22T08:30:00Z')), true, '9 h 30 à Paris');
  assert.equal(heureDAlerte(Date.parse('2026-11-22T20:30:00Z')), false, '21 h 30 à Paris');
});
