import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { construirePublic } from '../src/measure/public.mjs';
import { PAGE, politique, cspDeLaPage } from '../scripts/page-equipe.mjs';

// La page de l'équipe est publique : ses données et son code ne doivent rien laisser paraître
// de l'envers du décor. Ces tests en sont le garde-fou.

const maintenant = Date.parse('2026-09-18T16:00:00Z'); // 18 h à Paris
const article = (n) => ({ title: `Article ${n}`, link: `https://passion-aquitaine.ouest-france.fr/article-${n}/`, image: `https://passion-aquitaine.ouest-france.fr/wp-content/uploads/${n}.jpg`, guid: `g${n}` });
const history = [
  { guid: 'g1', channel: 'instagram', at: '2026-09-18T10:05:00Z', mediaId: '18054866228802666', titre: 'Article 1', lien: 'https://passion-aquitaine.ouest-france.fr/article-1/', lienPost: 'https://www.instagram.com/p/ABC/', format: 'carrousel', apercu: { texte: 'légende', image: 'https://passion-aquitaine.ouest-france.fr/social/1.jpg' } },
  { guid: 'g1', channel: 'threads', at: '2026-09-18T10:20:00Z', mediaId: '999', titre: 'Article 1', lienPost: 'javascript:alert(1)', lien: 'https://passion-aquitaine.ouest-france.fr/article-1/', apercu: { texte: 'x', image: null } },
  { guid: 'g2', channel: 'x', at: '2026-09-18T11:00:00Z', titre: 'Article 2', lien: 'https://passion-aquitaine.ouest-france.fr/article-2/' },
  { guid: 'g3', channel: 'facebook', at: '2026-09-18T06:10:00Z', mediaId: '1720946116697936_1', titre: 'Article 3', lienPost: 'https://evil.example.com/post', lien: 'https://passion-aquitaine.ouest-france.fr/article-3/', apercu: { image: 'https://evil.example.com/a.jpg' } },
];
const queue = [
  { guid: 'g4', channel: 'facebook', status: 'pending', dueAt: maintenant + 3600e3, article: article(4), dossier: { nature: 'actu_chaude' }, raison: 'Fenêtre occupée', prevuInitialement: maintenant, attempts: 2, lastError: 'Invalid OAuth access token EAAB123' },
  { guid: 'g5', channel: 'instagram', status: 'awaiting', dueAt: maintenant + 7200e3, article: article(5) },
  { guid: 'g6', channel: 'bluesky', status: 'pending', dueAt: maintenant + 1800e3, article: article(6) },
  { guid: 'g7', channel: 'x', status: 'pending', dueAt: maintenant + 900e3, article: article(7) },
  { guid: 'g8', channel: 'threads', status: 'failed', dueAt: maintenant - 3600e3, article: article(8), lastError: 'boom' },
];
const releves = { '2026-09-18': { facebook: 42626, instagram: 10146, threads: 1144, bluesky: 1 } };
const mesures = [{ guid: 'g1', channel: 'instagram', mediaId: '18054866228802666', jalon: 1, likes: 40, commentaires: 2, partages: null, publieLe: '2026-09-18T10:05:00Z' }];
const d = construirePublic({ history, queue, mesures, releves, controls: { paused: { bluesky: true }, validation: { instagram: true } }, maintenant });
const texte = JSON.stringify(d);

test('données publiques : aucune trace interne', () => {
  for (const interdit of ['mediaId', '18054866228802666', '1720946116697936', 'EAAB', 'OAuth', 'lastError', 'raison', 'Fenêtre occupée', 'prevuInitialement', 'actu_chaude', 'dossier', 'attempts', 'paused', 'validation', 'awaiting', 'pending', 'failed', 'boom', 'légende', 'github', 'telegram', 'robot']) {
    assert.ok(!texte.toLowerCase().includes(interdit.toLowerCase()), `« ${interdit} » ne doit pas apparaître`);
  }
  assert.deepEqual(Object.keys(d).sort(), ['depuis', 'majLe', 'mois', 'planning', 'publications', 'reseaux']);
  assert.deepEqual(Object.keys(d.planning[0]).sort(), ['heure', 'image', 'lien', 'reseau', 'titre']);
  assert.deepEqual(Object.keys(d.publications[0]).sort(), ['heure', 'image', 'lien', 'reseaux', 'titre']);
  assert.deepEqual(Object.keys(d.publications[0].reseaux[0]).sort(), ['heure', 'lien', 'reseau']);
});

test('X, publié à la main, n’apparaît nulle part', () => {
  assert.ok(!d.reseaux.some((r) => r.id === 'x'));
  assert.ok(!d.planning.some((p) => p.reseau === 'x'));
  assert.ok(!d.publications.some((p) => p.reseaux.some((r) => r.reseau === 'x')));
  assert.ok(!d.publications.some((p) => p.titre === 'Article 2'), 'un article paru seulement sur X n’est pas listé');
});

test('dernières publications : une carte par article, chaque réseau cliquable', () => {
  assert.deepEqual(d.publications.map((p) => p.titre), ['Article 1', 'Article 3'], 'du plus récent au plus ancien');
  assert.deepEqual(d.publications[0].reseaux.map((r) => r.reseau), ['instagram', 'threads']);
  assert.equal(d.publications[0].heure, '2026-09-18T10:20:00.000Z', 'heure de la dernière parution');
});

test('planning : seulement ce qui est confirmé, sur un réseau actif', () => {
  assert.deepEqual(d.planning.map((p) => p.reseau), ['facebook'], 'Bluesky en pause, Instagram en attente de feu vert, Threads en échec : rien de cela n’est annoncé');
});

test('liens et visuels : uniquement nos domaines', () => {
  const a1 = d.publications.find((p) => p.titre === 'Article 1');
  assert.equal(a1.reseaux.find((r) => r.reseau === 'instagram').lien, 'https://www.instagram.com/p/ABC/');
  assert.equal(a1.reseaux.find((r) => r.reseau === 'threads').lien, 'https://passion-aquitaine.ouest-france.fr/article-1/', 'un lien douteux est remplacé par l’article');
  assert.equal(a1.image, 'https://passion-aquitaine.ouest-france.fr/social/1.jpg');
  const a3 = d.publications.find((p) => p.titre === 'Article 3');
  assert.equal(a3.reseaux[0].lien, 'https://passion-aquitaine.ouest-france.fr/article-3/');
  assert.equal(a3.image, null, 'un visuel hors de notre site n’est jamais affiché');
});

test('chiffres : abonnés, publications et meilleure publication du mois', () => {
  const ig = d.reseaux.find((r) => r.id === 'instagram');
  assert.equal(ig.abonnes, 10146);
  assert.equal(ig.postsMois, 1);
  assert.equal(d.mois.publications, 3, 'X exclu');
  assert.equal(d.mois.interactions, 42);
  assert.equal(d.mois.top[0].titre, 'Article 1');
  assert.equal(d.depuis, '2026-09-18');
});

test('premières publications sans titre : titre, lien et visuel repris du flux', () => {
  const ancien = [{ guid: 'g9', channel: 'instagram', at: '2026-09-15T06:00:00Z', mediaId: '1' }];
  const flux = [{ guid: 'g9', title: 'Article du flux', link: 'https://passion-aquitaine.ouest-france.fr/flux/', image: 'https://passion-aquitaine.ouest-france.fr/wp-content/uploads/flux.jpg' }];
  const m = [{ guid: 'g9', channel: 'instagram', jalon: 1, likes: 17, commentaires: 20, publieLe: '2026-09-15T06:00:00Z' }];
  const r = construirePublic({ history: ancien, mesures: m, articles: flux, maintenant });
  assert.deepEqual(r.publications[0], {
    titre: 'Article du flux', lien: 'https://passion-aquitaine.ouest-france.fr/flux/', image: 'https://passion-aquitaine.ouest-france.fr/wp-content/uploads/flux.jpg', heure: '2026-09-15T06:00:00.000Z',
    reseaux: [{ reseau: 'instagram', heure: '2026-09-15T06:00:00.000Z', lien: 'https://passion-aquitaine.ouest-france.fr/flux/' }],
  });
  assert.equal(r.mois.top[0].interactions, 37);
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
  const permis = [/^https:\/\/www\.(facebook|instagram|threads)\.com\//, /^https:\/\/bsky\.app\/profile\//, /^http:\/\/www\.w3\.org\/2000\/svg$/];
  for (const u of externes) assert.ok(permis.some((p) => p.test(u)), `adresse inattendue : ${u}`);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+stylesheet/);
});
