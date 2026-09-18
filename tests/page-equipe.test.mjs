import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { construirePublic, nomVignette, visuelSource } from '../src/measure/public.mjs';
import { PAGE, politique, cspDeLaPage } from '../scripts/page-equipe.mjs';

// La page de l'équipe est publique : ses données et son code ne doivent rien laisser paraître
// de l'envers du décor. Ces tests en sont le garde-fou.

const maintenant = Date.parse('2026-09-18T16:00:00Z'); // 18 h à Paris
const SOCIAL = 'https://passion-aquitaine.ouest-france.fr/social';
const article = (n) => ({ title: `Article ${n}`, link: `https://passion-aquitaine.ouest-france.fr/article-${n}/`, image: `https://passion-aquitaine.ouest-france.fr/wp-content/uploads/${n}.jpg`, guid: `g${n}` });
const history = [
  { guid: 'g1', channel: 'instagram', at: '2026-09-18T10:05:00Z', mediaId: '18054866228802666', titre: 'Article 1', lien: 'https://passion-aquitaine.ouest-france.fr/article-1/', lienPost: 'https://www.instagram.com/p/ABC/', format: 'carrousel', apercu: { texte: 'légende', image: `${SOCIAL}/1-1.jpg` } },
  { guid: 'g1', channel: 'threads', at: '2026-09-18T10:20:00Z', mediaId: '999', titre: 'Article 1', lienPost: 'javascript:alert(1)', lien: 'https://passion-aquitaine.ouest-france.fr/article-1/', apercu: { texte: 'x', image: `${SOCIAL}/1-th.jpg` } },
  { guid: 'g2', channel: 'x', at: '2026-09-18T11:00:00Z', mediaId: 'kit-telegram', titre: 'Article 2', lien: 'https://passion-aquitaine.ouest-france.fr/article-2/', apercu: { image: `${SOCIAL}/2-x.jpg` } },
  { guid: 'g3', channel: 'facebook', at: '2026-09-18T06:10:00Z', mediaId: '1720946116697936_1', titre: 'Article 3', lienPost: 'https://evil.example.com/post', lien: 'https://passion-aquitaine.ouest-france.fr/article-3/', apercu: { image: 'https://evil.example.com/a.jpg' } },
  { guid: 'g0', channel: 'instagram', at: '2026-08-30T10:00:00Z', mediaId: '1', titre: 'Article d’août', lienPost: 'https://www.instagram.com/p/AOUT/' },
];
const queue = [
  { guid: 'g4', channel: 'facebook', status: 'pending', dueAt: maintenant + 3600e3, article: article(4), dossier: { nature: 'actu_chaude' }, raison: 'Fenêtre occupée', prevuInitialement: maintenant, attempts: 2, lastError: 'Invalid OAuth access token EAAB123' },
  { guid: 'g5', channel: 'instagram', status: 'awaiting', dueAt: maintenant + 7200e3, article: article(5) },
  { guid: 'g6', channel: 'bluesky', status: 'pending', dueAt: maintenant + 1800e3, article: article(6) },
  { guid: 'g7', channel: 'x', status: 'pending', dueAt: maintenant + 900e3, article: article(7) },
  { guid: 'g8', channel: 'threads', status: 'failed', dueAt: maintenant - 3600e3, article: article(8), lastError: 'boom' },
  { guid: 'g9', channel: 'instagram', status: 'pending', dueAt: maintenant + 5400e3, article: article(9) },
];
const releves = { '2026-09-18': { facebook: 42626, instagram: 10146, threads: 1144, bluesky: 1, x: 2940 } };
const mesures = [{ guid: 'g1', channel: 'instagram', mediaId: '18054866228802666', jalon: 1, likes: 40, commentaires: 2, partages: null, publieLe: '2026-09-18T10:05:00Z' }];
const vignette = (s) => `${SOCIAL}/${nomVignette(s)}`;
const archive = { '2026-07': { cle: '2026-07', publications: 4, articles: 2, interactions: 9, parReseau: {}, gains: {}, top: [] } };
const d = construirePublic({ history, queue, mesures, releves, archive, vignette, controls: { paused: { bluesky: true }, validation: { instagram: true } }, maintenant });
const texte = JSON.stringify(d);

test('données publiques : aucune trace interne', () => {
  for (const interdit of ['mediaId', '18054866228802666', '1720946116697936', 'kit-telegram', 'EAAB', 'OAuth', 'lastError', 'raison', 'Fenêtre occupée', 'prevuInitialement', 'actu_chaude', 'dossier', 'attempts', 'paused', 'validation', 'awaiting', 'pending', 'failed', 'boom', 'légende', 'github', 'telegram', 'robot']) {
    assert.ok(!texte.toLowerCase().includes(interdit.toLowerCase()), `« ${interdit} » ne doit pas apparaître`);
  }
  assert.deepEqual(Object.keys(d).sort(), ['depuis', 'majLe', 'mois', 'planning', 'publications', 'reseaux']);
  assert.deepEqual(Object.keys(d.planning[0]).sort(), ['format', 'heure', 'image', 'lien', 'manuel', 'reseau', 'titre']);
  assert.deepEqual(Object.keys(d.publications[0]).sort(), ['heure', 'image', 'lien', 'reseaux', 'titre']);
  assert.deepEqual(Object.keys(d.publications[0].reseaux[0]).sort(), ['heure', 'lien', 'reseau']);
});

test('X figure parmi nos réseaux, avec ses abonnés saisis à la main', () => {
  const x = d.reseaux.find((r) => r.id === 'x');
  assert.equal(x.abonnes, 2940);
  assert.deepEqual(d.reseaux.map((r) => r.id), ['facebook', 'instagram', 'x', 'threads', 'bluesky']);
});

test('planning : publications manuelles signalées, story après chaque carrousel', () => {
  assert.deepEqual(d.planning.map((p) => [p.reseau, p.format, p.manuel]), [
    ['x', null, true],
    ['facebook', null, false],
    ['instagram', null, false],
    ['instagram', 'story', true],
  ], 'Bluesky en pause, Instagram en attente de feu vert, Threads en échec : rien de cela n’est annoncé');
  assert.equal(d.planning[2].heure, d.planning[3].heure, 'la story part avec le carrousel');
});

test('dernières publications : une carte par article, lien direct de chaque post', () => {
  assert.deepEqual(d.publications.map((p) => p.titre), ['Article 2', 'Article 1', 'Article 3', 'Article d’août']);
  const a1 = d.publications.find((p) => p.titre === 'Article 1');
  assert.deepEqual(a1.reseaux.map((r) => r.reseau), ['instagram', 'threads']);
  assert.equal(a1.heure, '2026-09-18T10:20:00.000Z', 'heure de la dernière parution');
  assert.equal(a1.reseaux[0].lien, 'https://www.instagram.com/p/ABC/');
  assert.equal(a1.reseaux[1].lien, null, 'jamais l’article à la place du post : un lien douteux est simplement écarté');
  assert.equal(a1.lien, 'https://passion-aquitaine.ouest-france.fr/article-1/', 'le titre, lui, mène à l’article');
  assert.equal(d.publications[0].reseaux[0].lien, null, 'le post X n’est pas connu : la page renverra vers le compte');
});

test('visuels : le 4:5 composé pour les réseaux, en vignette légère, jamais hors de notre site', () => {
  assert.equal(visuelSource(history, 'g1'), `${SOCIAL}/1-1.jpg`, 'celui d’Instagram d’abord');
  const date = (g) => new Map([[g, { date: '2026-08-30T08:00:00Z' }]]);
  assert.match(visuelSource(history, 'g0', date('g0')), /\/social\/20260830-[0-9a-f]{8}-1\.jpg$/, 'carrousel ancien retrouvé par son nom');
  assert.equal(visuelSource(history, 'g3', date('g3')), null, 'sans carrousel Instagram, rien à chercher');
  assert.equal(d.publications.find((p) => p.titre === 'Article 1').image, `${SOCIAL}/1-1-vignette.jpg`);
  assert.equal(d.publications.find((p) => p.titre === 'Article 2').image, `${SOCIAL}/2-x-vignette.jpg`);
  assert.equal(d.publications.find((p) => p.titre === 'Article 3').image, null);
  const sans = construirePublic({ history, articles: [article(1)].map((a) => ({ ...a, guid: 'g1' })), maintenant });
  assert.equal(sans.publications.find((p) => p.titre === 'Article 1').image, 'https://passion-aquitaine.ouest-france.fr/wp-content/uploads/1.jpg', 'sans vignette, la photo de l’article');
});

test('bilans mensuels : mois en cours, mois précédents recalculés, archive conservée', () => {
  assert.deepEqual(d.mois.map((m) => m.cle), ['2026-09', '2026-08', '2026-07']);
  const sept = d.mois[0];
  assert.equal(sept.publications, 4, 'X compris');
  assert.equal(sept.parReseau.x, 1);
  assert.equal(sept.interactions, 42);
  assert.equal(sept.top[0].titre, 'Article 1');
  assert.equal(sept.top[0].image, `${SOCIAL}/1-1-vignette.jpg`);
  assert.equal(sept.gains.facebook, null, 'un seul relevé : pas encore de gain à annoncer');
  assert.equal(d.mois[1].publications, 1);
  assert.equal(d.mois[2].interactions, 9, 'un mois sorti de l’historique reste consultable');
});

test('premières publications sans titre : titre et lien d’article repris du flux', () => {
  const ancien = [{ guid: 'g9', channel: 'instagram', at: '2026-09-15T06:00:00Z', mediaId: '1' }];
  const flux = [{ guid: 'g9', title: 'Article du flux', link: 'https://passion-aquitaine.ouest-france.fr/flux/', image: 'https://passion-aquitaine.ouest-france.fr/wp-content/uploads/flux.jpg' }];
  const m = [{ guid: 'g9', channel: 'instagram', jalon: 1, likes: 17, commentaires: 20, publieLe: '2026-09-15T06:00:00Z' }];
  const r = construirePublic({ history: ancien, mesures: m, articles: flux, maintenant });
  assert.deepEqual(r.publications[0], {
    titre: 'Article du flux', lien: 'https://passion-aquitaine.ouest-france.fr/flux/', image: 'https://passion-aquitaine.ouest-france.fr/wp-content/uploads/flux.jpg', heure: '2026-09-15T06:00:00.000Z',
    reseaux: [{ reseau: 'instagram', heure: '2026-09-15T06:00:00.000Z', lien: null }],
  });
  assert.equal(r.mois[0].top[0].interactions, 37);
  assert.equal(construirePublic({ history: ancien, mesures: m, maintenant }).publications.length, 0, 'sans titre connu, rien n’est affiché');
});

// ---------- La page ----------
const html = readFileSync(PAGE, 'utf8');

test('page : la politique de sécurité correspond au code (node scripts/page-equipe.mjs)', () => {
  assert.equal(cspDeLaPage(html), politique(html));
  assert.equal(politique(html.replace(/\r?\n/g, '\r\n')), politique(html), 'empreintes identiques en fins de ligne Windows');
  assert.match(html, /<meta name="robots" content="noindex/);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
});

test('page : aucun mot de l’envers du décor', () => {
  const sansMeta = html.replace('<meta name="robots"', '<meta');
  for (const motif of [/robot/i, /automat/i, /\bbot\b/i, /telegram/i, /github/i, /\bcron/i, /\bkit\b/i, /\bIA\b/, /pilotage/i, /passages?\b/i, /jeton/i, /token/i, /valid/i, /\bpause/i, /algorithm/i, /généré/i, /o2switch/i, /sftp/i, /\bftp/i, /pa-social/i, /d00l/i, /claude/i, /file d’attente/i]) {
    const trouve = sansMeta.match(motif);
    assert.equal(trouve, null, `mot interdit « ${trouve?.[0]} » vers : ${trouve ? sansMeta.slice(Math.max(0, trouve.index - 40), trouve.index + 40) : ''}`);
  }
});

test('page : aucune injection de HTML, aucune ressource extérieure', () => {
  assert.doesNotMatch(html, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  const externes = [...html.matchAll(/https?:\/\/[^\s"'`)<]+/g)].map((m) => m[0]);
  const permis = [/^https:\/\/www\.(facebook|instagram|threads)\.com\//, /^https:\/\/x\.com\/lovaquitaine$/, /^https:\/\/bsky\.app\/profile\//, /^http:\/\/www\.w3\.org\/2000\/svg$/];
  for (const u of externes) assert.ok(permis.some((p) => p.test(u)), `adresse inattendue : ${u}`);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+stylesheet/);
});
