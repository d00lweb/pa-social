import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fromRoot } from '../src/core/config.mjs';
import { FORMATS_FACEBOOK, formatFacebook, formatParDefaut, jourDuTest, lienMarque, testFacebook } from '../src/core/formats-facebook.mjs';
import { parametres, prepare, textePhoto } from '../src/channels/facebook.mjs';
import { releve } from '../src/measure/collect.mjs';
import { capturer } from '../src/measure/apercus.mjs';
import { testPublic } from '../src/measure/public.mjs';
import { replyTextFor } from '../src/channels/threads.mjs';
import { composeX } from '../src/brain/compose.mjs';

// Test « photo ou lien » sur Facebook (décidé le 22/11/2026) : un format par jour, à tour de rôle,
// du 23/11 au 13/12/2026, puis retour seul au format par défaut. Tout vient de config/channels.json.
const config = JSON.parse(readFileSync(fromRoot('config/channels.json'), 'utf8'));
const fb = config.channels.facebook;
const TZ = 'Europe/Paris';
const paris = (s) => Date.parse(`${s}+01:00`); // novembre-décembre : heure d'hiver
const jourParis = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(ms));
const JOUR = 86400e3;

const article = { guid: 'https://site.fr/?p=1', title: 'La truffe du Périgord', link: 'https://site.fr/truffe/', image: null, date: Date.parse('2026-11-22T10:00:00Z') };
const dossier = { facebook: { texte: 'La France importe plus de truffes qu’elle n’en récolte 🍄' }, visuel: { texte_alternatif: 'Un marché aux truffes en Dordogne' }, lieu: null };
const muet = () => {};

test('test Facebook : la configuration décrit trois semaines, photo et lien à tour de rôle', () => {
  const t = testFacebook(fb);
  assert.deepEqual(t, { debut: '2026-11-23', fin: '2026-12-13', formats: ['photo', 'lien'], jours: 21 });
  assert.equal(formatParDefaut(fb), 'lien', 'hors test, la publication avec lien');
  assert.ok(FORMATS_FACEBOOK.includes(fb.format));
});

test('test Facebook : un format par jour, le même matin et soir, en alternance', () => {
  const vus = { photo: new Map(), lien: new Map() };
  for (let ms = paris('2026-11-23T12:00:00'); jourParis(ms) <= '2026-12-13'; ms += JOUR) {
    const j = jourParis(ms);
    const matin = formatFacebook(paris(`${j}T08:05:00`), fb, TZ);
    const soir = formatFacebook(paris(`${j}T21:29:00`), fb, TZ);
    assert.equal(matin, soir, `${j} : les deux publications du jour dans le même format`);
    const veille = formatFacebook(paris(`${j}T08:05:00`) - JOUR, fb, TZ);
    if (j > '2026-11-23') assert.notEqual(matin, veille, `${j} : l’autre format que la veille`);
    const jourSemaine = new Date(`${j}T12:00:00Z`).getUTCDay();
    vus[matin].set(jourSemaine, (vus[matin].get(jourSemaine) ?? 0) + 1);
  }
  assert.equal(formatFacebook(paris('2026-11-23T09:27:00'), fb, TZ), 'photo', 'lundi 23/11 : photo');
  assert.equal(formatFacebook(paris('2026-11-24T08:10:00'), fb, TZ), 'lien', 'mardi 24/11 : lien');
  // chaque jour de la semaine revient trois fois : deux pour l'un, une pour l'autre, jamais trois-zéro
  for (let d = 0; d < 7; d++) {
    const [p, l] = [vus.photo.get(d) ?? 0, vus.lien.get(d) ?? 0];
    assert.equal(p + l, 3);
    assert.ok(Math.abs(p - l) === 1, `jour ${d} : ${p} photo, ${l} lien`);
  }
  const total = (m) => [...m.values()].reduce((a, b) => a + b, 0);
  assert.deepEqual([total(vus.photo), total(vus.lien)], [11, 10]);
});

test('test Facebook : le jour se compte à l’heure de Paris, pas en UTC', () => {
  // 23 h 30 à Paris le 23/11 = 22 h 30 UTC ; 0 h 30 le 24/11 = 23 h 30 UTC le 23/11
  assert.equal(jourDuTest(paris('2026-11-23T23:30:00'), fb, TZ).jour, 1);
  assert.equal(jourDuTest(paris('2026-11-24T00:30:00'), fb, TZ).jour, 2);
  assert.equal(jourDuTest(paris('2026-12-13T21:00:00'), fb, TZ).jour, 21);
});

test('test Facebook : avant et après, le format par défaut ; arrêt en une ligne', () => {
  assert.equal(jourDuTest(paris('2026-11-22T21:00:00'), fb, TZ), null);
  assert.equal(formatFacebook(paris('2026-11-22T21:00:00'), fb, TZ), 'lien', 'la veille : rien ne change');
  assert.equal(jourDuTest(paris('2026-12-14T08:10:00'), fb, TZ), null);
  assert.equal(formatFacebook(paris('2026-12-14T08:10:00'), fb, TZ), 'lien', 'le lendemain de la fin : retour seul au format par défaut');
  assert.equal(formatFacebook(paris('2027-03-01T08:10:00'), fb, TZ), 'lien');
  // arrêter le test : actif à false
  assert.equal(formatFacebook(paris('2026-11-23T09:00:00'), { ...fb, test: { ...fb.test, actif: false } }, TZ), 'lien');
  // un autre format par défaut se règle aussi en une ligne
  assert.equal(formatFacebook(paris('2026-12-20T09:00:00'), { ...fb, format: 'photo' }, TZ), 'photo');
});

test('test Facebook : une configuration mal écrite ne change rien', () => {
  const casse = (t) => formatFacebook(paris('2026-11-23T09:00:00'), { ...fb, test: { ...fb.test, ...t } }, TZ);
  assert.equal(casse({ formats: ['photo', 'album'] }), 'lien', 'format inconnu');
  assert.equal(casse({ formats: ['photo'] }), 'lien', 'un seul format : rien à comparer');
  assert.equal(casse({ formats: ['photo', 'photo'] }), 'lien');
  assert.equal(casse({ fin: '2026-11-01' }), 'lien', 'fin avant le début');
  assert.equal(casse({ debut: '23/11/2026' }), 'lien', 'date mal écrite');
  assert.equal(casse({ alternance: 'semaine' }), 'lien', 'règle inconnue');
  assert.equal(formatFacebook(paris('2026-11-23T09:00:00'), { ...fb, test: undefined, format: 'reel' }, TZ), 'lien');
});

test('liens marqués : Facebook seulement, un marqueur par format, canonique intacte', () => {
  assert.equal(lienMarque('https://site.fr/truffe/', 'photo', fb), 'https://site.fr/truffe/?utm_source=facebook&utm_medium=social&utm_campaign=fb-photo');
  assert.equal(lienMarque('https://site.fr/truffe/', 'lien', fb), 'https://site.fr/truffe/?utm_source=facebook&utm_medium=social&utm_campaign=fb-lien');
  assert.equal(lienMarque('https://site.fr/a/?x=1', 'lien', fb), 'https://site.fr/a/?x=1&utm_source=facebook&utm_medium=social&utm_campaign=fb-lien');
  assert.equal(lienMarque('https://site.fr/a/', 'lien', { ...fb, utm: undefined }), 'https://site.fr/a/', 'sans modèle : adresse nue');
  for (const [id, c] of Object.entries(config.channels)) if (id !== 'facebook') assert.equal(c.utm, undefined, `${id} : aucun marqueur`);
  // les autres réseaux publient l'adresse nue
  assert.doesNotMatch(replyTextFor(article), /utm_/);
  assert.doesNotMatch(composeX({ x: { texte: 'Un texte' }, bluesky: {} }, article.link), /utm_/);
});

test('format lien : la phrase, la carte d’aperçu, l’adresse marquée fb-lien', async () => {
  const pkg = await prepare(article, { dossier, quand: paris('2026-11-24T08:10:00'), canal: fb, log: muet });
  assert.equal(pkg.mode, 'lien');
  assert.equal(pkg.text, dossier.facebook.texte, 'la phrase seule, sans ligne ajoutée');
  assert.deepEqual(parametres(pkg), { message: dossier.facebook.texte, link: 'https://site.fr/truffe/?utm_source=facebook&utm_medium=social&utm_campaign=fb-lien', published: 'true' });
  assert.equal(pkg.article.link, 'https://site.fr/truffe/', 'l’historique garde l’adresse nue');
});

test('format photo : visuel, phrase, ligne du commentaire, lien marqué fb-photo en commentaire', async () => {
  const fabriquer = async () => ({ imageUrl: 'https://site.fr/social/20261122-abcd1234-fb.jpg', files: [] });
  const pkg = await prepare(article, { dossier, quand: paris('2026-11-23T09:27:00'), canal: fb, log: muet, fabriquer });
  assert.equal(pkg.mode, 'photo');
  assert.equal(pkg.text, `${dossier.facebook.texte}\nL’article est en premier commentaire.`);
  assert.equal(pkg.text, textePhoto(dossier.facebook.texte, fb));
  assert.doesNotMatch(pkg.text, /https?:\/\//, 'aucun lien dans le texte');
  assert.doesNotMatch(pkg.text, /\b(aimez|likez|partagez|commentez|taguez|identifiez)\b/i, 'aucune demande d’interaction');
  assert.deepEqual(parametres(pkg), { url: 'https://site.fr/social/20261122-abcd1234-fb.jpg', caption: pkg.text, published: 'true', alt_text_custom: 'Un marché aux truffes en Dordogne' });
  const ed = JSON.parse(readFileSync(fromRoot('config/editorial.json'), 'utf8'));
  const [lead, lien] = [pkg.comment.slice(0, pkg.comment.lastIndexOf(' ')), pkg.comment.slice(pkg.comment.lastIndexOf(' ') + 1)];
  assert.ok(ed.facebookCommentLeads.includes(lead), `formule tournante : « ${lead} »`);
  assert.equal(lien, 'https://site.fr/truffe/?utm_source=facebook&utm_medium=social&utm_campaign=fb-photo');
});

test('format photo impossible (pas d’image) : l’article part quand même, en lien', async () => {
  const pkg = await prepare(article, { dossier, quand: paris('2026-11-23T09:27:00'), canal: fb, log: muet });
  assert.equal(pkg.mode, 'lien', 'le format réellement publié est celui qu’on enregistre');
  assert.match(pkg.lien, /utm_campaign=fb-lien$/);
});

test('format enregistré : dans l’historique (aperçu) et dans chaque relevé', async () => {
  const fabriquer = async () => ({ imageUrl: 'https://site.fr/social/x-fb.jpg', files: [] });
  const pkg = await prepare(article, { dossier, quand: paris('2026-11-23T09:27:00'), canal: fb, log: muet, fabriquer });
  const apercu = await capturer(pkg, 'facebook', { log: muet });
  assert.equal(apercu.mode, 'photo');
  assert.equal(apercu.image, 'https://site.fr/social/x-fb.jpg', 'le visuel publié, même repris d’Instagram');
  assert.equal(apercu.reponse, pkg.comment);
  const entree = { guid: 'g', channel: 'facebook', mediaId: '1_2', at: '2026-11-23T08:27:00Z', format: pkg.mode };
  const m = releve(entree, 7, { likes: 3, reactions: 5, partages: 1, vues: 900 }, Date.parse('2026-11-30T09:00:00Z'));
  assert.equal(m.format, 'photo');
  assert.equal(m.jalon, 7);
  assert.equal(m.reactions, 5);
  assert.equal(releve({ ...entree, format: null }, 1, {}, Date.now()).format, undefined, 'publication d’avant : pas de format inventé');
});

test('page de l’équipe : le test annoncé tant qu’il n’est pas fini, sans rien d’interne', () => {
  const veille = testPublic(fb, paris('2026-11-22T21:00:00'));
  assert.deepEqual(veille, { reseau: 'facebook', du: '2026-11-23', au: '2026-12-13', jours: 21, jour: null, formats: ['photo', 'lien'], aujourdhui: null, demain: 'photo' });
  const j1 = testPublic(fb, paris('2026-11-23T10:00:00'));
  assert.equal(j1.jour, 1);
  assert.equal(j1.aujourdhui, 'photo');
  assert.equal(j1.demain, 'lien');
  assert.equal(testPublic(fb, paris('2026-12-13T22:00:00')).demain, null, 'dernier jour : pas de lendemain');
  assert.equal(testPublic(fb, paris('2026-12-14T08:00:00')), null, 'fini : la section disparaît');
  assert.equal(testPublic({ ...fb, test: { ...fb.test, actif: false } }, paris('2026-11-25T10:00:00')), null);
});
