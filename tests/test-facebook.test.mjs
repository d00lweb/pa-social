import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fromRoot } from '../src/core/config.mjs';
import { FORMATS_FACEBOOK, formatFacebook, formatParDefaut, jourDuTest, lienMarque, testFacebook } from '../src/core/formats-facebook.mjs';
import { parametres, prepare, publish, textePhoto } from '../src/channels/facebook.mjs';
import { releve } from '../src/measure/collect.mjs';
import { capturer } from '../src/measure/apercus.mjs';
import { testPublic } from '../src/measure/public.mjs';
import { agreger } from '../src/measure/rapport.mjs';

// Test « photo ou lien » sur Facebook (décidé le 22/11/2026) : un format par jour, à tour de rôle,
// du 23/11 au 13/12/2026, puis retour seul au format par défaut.
// Canal figé ici : couper le test ou changer ses dates dans config/channels.json ne doit jamais faire
// échouer ces tests, que chaque passage relance avant de publier (un échec arrêterait tout).
const FB = {
  format: 'lien',
  test: { actif: true, debut: '2026-11-23', fin: '2026-12-13', formats: ['photo', 'lien'], alternance: 'jour' },
  utm: 'at_medium=social&at_campaign=fb-{format}',
  ligneCommentaire: 'L’article est en premier commentaire.',
  commentDelayMinutes: [1, 3],
};
const TZ = 'Europe/Paris';
const paris = (s) => Date.parse(`${s}+01:00`); // novembre-décembre : heure d'hiver
const jourParis = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(ms));
const JOUR = 86400e3;

const article = { guid: 'https://site.fr/?p=1', title: 'La truffe du Périgord', link: 'https://site.fr/truffe/', image: null, date: Date.parse('2026-11-22T10:00:00Z') };
const dossier = { facebook: { texte: 'La France importe plus de truffes qu’elle n’en récolte 🍄' }, visuel: { texte_alternatif: 'Un marché aux truffes en Dordogne' }, lieu: null };
const muet = () => {};
const visuelFactice = (imageUrl = 'https://site.fr/social/20261122-abcd1234-fb.jpg') => async () => ({ imageUrl, files: [] });

test('test Facebook : trois semaines, photo et lien à tour de rôle', () => {
  assert.deepEqual(testFacebook(FB), { debut: '2026-11-23', fin: '2026-12-13', formats: ['photo', 'lien'], jours: 21 });
  assert.equal(formatParDefaut(FB), 'lien', 'hors test, la publication avec lien');
});

test('configuration réelle : quelle qu’elle soit, un format connu chaque jour', () => {
  // seule exigence sur config/channels.json : ne jamais produire un format inconnu (test coupé, dates changées : tout passe)
  const fb = JSON.parse(readFileSync(fromRoot('config/channels.json'), 'utf8')).channels.facebook;
  for (let ms = paris('2026-11-20T08:30:00'); ms < paris('2027-01-10T08:30:00'); ms += JOUR / 2) {
    assert.ok(FORMATS_FACEBOOK.includes(formatFacebook(ms, fb, TZ)));
  }
});

test('test Facebook : un format par jour, le même matin et soir, en alternance', () => {
  const vus = { photo: new Map(), lien: new Map() };
  for (let ms = paris('2026-11-23T12:00:00'); jourParis(ms) <= '2026-12-13'; ms += JOUR) {
    const j = jourParis(ms);
    const matin = formatFacebook(paris(`${j}T08:05:00`), FB, TZ);
    const soir = formatFacebook(paris(`${j}T21:29:00`), FB, TZ);
    assert.equal(matin, soir, `${j} : les deux publications du jour dans le même format`);
    const veille = formatFacebook(paris(`${j}T08:05:00`) - JOUR, FB, TZ);
    if (j > '2026-11-23') assert.notEqual(matin, veille, `${j} : l’autre format que la veille`);
    const jourSemaine = new Date(`${j}T12:00:00Z`).getUTCDay();
    vus[matin].set(jourSemaine, (vus[matin].get(jourSemaine) ?? 0) + 1);
  }
  assert.equal(formatFacebook(paris('2026-11-23T09:27:00'), FB, TZ), 'photo', 'lundi 23/11 : photo');
  assert.equal(formatFacebook(paris('2026-11-24T08:10:00'), FB, TZ), 'lien', 'mardi 24/11 : lien');
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
  assert.equal(jourDuTest(paris('2026-11-23T23:30:00'), FB, TZ).jour, 1);
  assert.equal(jourDuTest(paris('2026-11-24T00:30:00'), FB, TZ).jour, 2);
  assert.equal(jourDuTest(paris('2026-12-13T21:00:00'), FB, TZ).jour, 21);
});

test('test Facebook : avant et après, le format par défaut ; arrêt en une ligne', () => {
  assert.equal(jourDuTest(paris('2026-11-22T21:00:00'), FB, TZ), null);
  assert.equal(formatFacebook(paris('2026-11-22T21:00:00'), FB, TZ), 'lien', 'la veille : rien ne change');
  assert.equal(jourDuTest(paris('2026-12-14T08:10:00'), FB, TZ), null);
  assert.equal(formatFacebook(paris('2026-12-14T08:10:00'), FB, TZ), 'lien', 'le lendemain de la fin : retour seul au format par défaut');
  assert.equal(formatFacebook(paris('2027-03-01T08:10:00'), FB, TZ), 'lien');
  // arrêter le test : actif à false
  assert.equal(formatFacebook(paris('2026-11-23T09:00:00'), { ...FB, test: { ...FB.test, actif: false } }, TZ), 'lien');
  // un autre format par défaut se règle aussi en une ligne
  assert.equal(formatFacebook(paris('2026-12-20T09:00:00'), { ...FB, format: 'photo' }, TZ), 'photo');
});

test('test Facebook : une configuration mal écrite ne change rien', () => {
  const casse = (t) => formatFacebook(paris('2026-11-23T09:00:00'), { ...FB, test: { ...FB.test, ...t } }, TZ);
  assert.equal(casse({ formats: ['photo', 'album'] }), 'lien', 'format inconnu');
  assert.equal(casse({ formats: ['photo'] }), 'lien', 'un seul format : rien à comparer');
  assert.equal(casse({ formats: ['photo', 'photo'] }), 'lien');
  assert.equal(casse({ fin: '2026-11-01' }), 'lien', 'fin avant le début');
  assert.equal(casse({ debut: '23/11/2026' }), 'lien', 'date mal écrite');
  assert.equal(casse({ alternance: 'semaine' }), 'lien', 'règle inconnue');
  assert.equal(formatFacebook(paris('2026-11-23T09:00:00'), { ...FB, test: undefined, format: 'reel' }, TZ), 'lien');
});

// Paramètres de campagne de Piano, jamais utm_ : Facebook ne lit plus nos articles quand l'adresse en porte un (22/11/2026)
test('liens marqués : un marqueur par format, et seulement dans le module Facebook', () => {
  assert.equal(lienMarque('https://site.fr/truffe/', 'photo', FB), 'https://site.fr/truffe/?at_medium=social&at_campaign=fb-photo');
  assert.equal(lienMarque('https://site.fr/truffe/', 'lien', FB), 'https://site.fr/truffe/?at_medium=social&at_campaign=fb-lien');
  assert.equal(lienMarque('https://site.fr/a/?x=1', 'lien', FB), 'https://site.fr/a/?x=1&at_medium=social&at_campaign=fb-lien');
  assert.equal(lienMarque('https://site.fr/a/', 'lien', { ...FB, utm: undefined }), 'https://site.fr/a/', 'sans modèle : adresse nue');
  // aucun autre réseau ne marque ses liens : lienMarque n'est appelé que par channels/facebook.mjs
  const appelants = [];
  const parcourir = (dir) => {
    for (const e of readdirSync(fromRoot(dir), { withFileTypes: true })) {
      if (e.isDirectory()) parcourir(`${dir}/${e.name}`);
      else if (e.name.endsWith('.mjs') && /lienMarque\(/.test(readFileSync(fromRoot(dir, e.name), 'utf8'))) appelants.push(`${dir}/${e.name}`);
    }
  };
  parcourir('src');
  assert.deepEqual(appelants.sort(), ['src/channels/facebook.mjs', 'src/core/formats-facebook.mjs']);
});

test('format lien : la phrase, la carte d’aperçu, l’adresse marquée fb-lien', async () => {
  const pkg = await prepare(article, { dossier, quand: paris('2026-11-24T08:10:00'), canal: FB, log: muet });
  assert.equal(pkg.mode, 'lien');
  assert.equal(pkg.formatPrevu, 'lien');
  assert.equal(pkg.text, dossier.facebook.texte, 'la phrase seule, sans ligne ajoutée');
  assert.deepEqual(parametres(pkg), { message: dossier.facebook.texte, link: 'https://site.fr/truffe/?at_medium=social&at_campaign=fb-lien', published: 'true' });
  assert.equal(pkg.article.link, 'https://site.fr/truffe/', 'l’historique garde l’adresse nue');
});

test('format photo : visuel, phrase, ligne du commentaire, lien marqué fb-photo en commentaire', async () => {
  const pkg = await prepare(article, { dossier, quand: paris('2026-11-23T09:27:00'), canal: FB, log: muet, fabriquer: visuelFactice() });
  assert.equal(pkg.mode, 'photo');
  assert.equal(pkg.text, `${dossier.facebook.texte}\nL’article est en premier commentaire.`);
  assert.equal(pkg.text, textePhoto(dossier.facebook.texte, FB));
  assert.doesNotMatch(pkg.text, /https?:\/\//, 'aucun lien dans le texte');
  assert.doesNotMatch(pkg.text, /\b(aimez|likez|partagez|commentez|taguez|identifiez)\b/i, 'aucune demande d’interaction');
  assert.deepEqual(parametres(pkg), { url: 'https://site.fr/social/20261122-abcd1234-fb.jpg', caption: pkg.text, published: 'true', alt_text_custom: 'Un marché aux truffes en Dordogne' });
  const ed = JSON.parse(readFileSync(fromRoot('config/editorial.json'), 'utf8'));
  const [lead, lien] = [pkg.comment.slice(0, pkg.comment.lastIndexOf(' ')), pkg.comment.slice(pkg.comment.lastIndexOf(' ') + 1)];
  assert.ok(ed.facebookCommentLeads.includes(lead), `formule tournante : « ${lead} »`);
  assert.equal(lien, 'https://site.fr/truffe/?at_medium=social&at_campaign=fb-photo');
});

test('jour photo sans photo possible : l’article part quand même, en lien, et on le sait', async () => {
  // pas d'image dans le flux : garde-fou du visuel, repli en lien
  const sansImage = await prepare(article, { dossier, quand: paris('2026-11-23T09:27:00'), canal: FB, log: muet });
  assert.equal(sansImage.mode, 'lien', 'le format réellement publié est celui qu’on enregistre');
  assert.equal(sansImage.formatPrevu, 'photo', 'le format du jour reste connu');
  assert.match(sansImage.lien, /at_campaign=fb-lien$/);
  // dernier des trois essais : en lien plutôt que perdre l'article
  let fabrique = false;
  const dernier = await prepare(article, { dossier, quand: paris('2026-11-23T09:27:00'), canal: FB, log: muet, dernierEssai: true, fabriquer: async () => { fabrique = true; return {}; } });
  assert.equal(dernier.mode, 'lien');
  assert.equal(fabrique, false, 'aucun visuel tenté');
  // une autre erreur (réseau, dépôt) suit le cours normal des essais
  await assert.rejects(prepare(article, { dossier, quand: paris('2026-11-23T09:27:00'), canal: FB, log: muet, fabriquer: async () => { throw new Error('Image 503 : https://site.fr/a.jpg'); } }), /Image 503/);
});

test('format enregistré : porté par la publication préparée, son aperçu et chaque relevé', async () => {
  const pkg = await prepare(article, { dossier, quand: paris('2026-11-23T09:27:00'), canal: FB, log: muet, fabriquer: visuelFactice('https://site.fr/social/x-fb.jpg') });
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

// Le réseau remplacé : chaque appel est noté, sans jeton
async function avecReseau(repondre, f) {
  const avant = { fetch: globalThis.fetch, env: { ...process.env } };
  process.env.FB_TOKEN = 'jeton-de-test';
  process.env.FB_PAGE_ID = '42';
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  const appels = [];
  globalThis.fetch = async (url, opts = {}) => {
    const corps = opts.body ? Object.fromEntries(new URLSearchParams(opts.body)) : null;
    if (corps) delete corps.access_token;
    const u = String(url).replace(/access_token=[^&]+&?/, '');
    appels.push({ methode: opts.method ?? 'GET', url: u, corps });
    const r = repondre(u, opts.method ?? 'GET');
    if (!r) throw new Error(`appel inattendu : ${u}`);
    return new Response(r.texte ?? JSON.stringify(r.json), { status: r.statut ?? 200, headers: { 'content-type': r.type ?? 'application/json' } });
  };
  try {
    return await f(appels);
  } finally {
    globalThis.fetch = avant.fetch;
    process.env = avant.env;
  }
}
const canalSansAttente = { ...FB, commentDelayMinutes: [0, 0] };

test('publication photo : la photo, puis le lien en commentaire sous la publication de la Page', async () => {
  const pkg = await prepare(article, { dossier, quand: paris('2026-11-23T09:27:00'), canal: FB, log: muet, fabriquer: visuelFactice('https://site.fr/social/a-fb.jpg') });
  await avecReseau((u, m) => {
    if (u === 'https://site.fr/social/a-fb.jpg') return { texte: 'x', type: 'image/jpeg' };
    if (m === 'POST' && u.endsWith('/42/photos')) return { json: { id: 'photo9', post_id: '42_777' } };
    if (m === 'GET' && u.includes('/42_777?')) return { json: { permalink_url: 'https://www.facebook.com/x/posts/777' } };
    if (m === 'POST' && u.endsWith('/42_777/comments')) return { json: { id: 'c1' } };
    return null;
  }, async (appels) => {
    const r = await publish(pkg, { channel: canalSansAttente });
    assert.deepEqual(r, { mediaId: '42_777', lien: 'https://www.facebook.com/x/posts/777' }, 'la publication de la Page, pas la photo seule');
    const photo = appels.find((a) => a.url.endsWith('/42/photos'));
    assert.deepEqual(photo.corps, { url: 'https://site.fr/social/a-fb.jpg', caption: pkg.text, published: 'true', alt_text_custom: 'Un marché aux truffes en Dordogne' });
    const commentaire = appels.find((a) => a.url.endsWith('/comments'));
    assert.equal(commentaire.url.split('/').at(-2), '42_777', 'le commentaire va sous la publication');
    assert.equal(commentaire.corps.message, pkg.comment);
    assert.ok(appels.indexOf(photo) < appels.indexOf(commentaire), 'la photo d’abord, le lien ensuite');
    assert.ok(!appels.some((a) => a.url.endsWith('/feed')), 'aucune publication avec lien en plus');
  });
});

test('publication photo : commentaire refusé, la photo reste en ligne et rien n’est rejoué', async () => {
  const pkg = await prepare(article, { dossier, quand: paris('2026-11-23T09:27:00'), canal: FB, log: muet, fabriquer: visuelFactice('https://site.fr/social/a-fb.jpg') });
  await avecReseau((u, m) => {
    if (u === 'https://site.fr/social/a-fb.jpg') return { texte: 'x', type: 'image/jpeg' };
    if (m === 'POST' && u.endsWith('/42/photos')) return { json: { id: 'photo9', post_id: '42_777' } };
    if (m === 'GET' && u.includes('/42_777?')) return { json: { permalink_url: 'https://www.facebook.com/x/posts/777' } };
    if (m === 'POST' && u.endsWith('/comments')) return { statut: 400, json: { error: { message: 'refusé', code: 100 } } };
    return null;
  }, async (appels) => {
    const erreurs = console.error;
    console.error = muet;
    try {
      const r = await publish(pkg, { channel: canalSansAttente });
      assert.equal(r.mediaId, '42_777', 'publication réussie : pas de nouvel essai');
      assert.equal(appels.filter((a) => a.url.endsWith('/42/photos')).length, 1);
    } finally {
      console.error = erreurs;
    }
  });
});

test('publication avec lien : une seule publication, sans commentaire', async () => {
  const pkg = await prepare(article, { dossier, quand: paris('2026-11-24T08:10:00'), canal: FB, log: muet });
  await avecReseau((u, m) => {
    if (m === 'POST' && u.endsWith('/42/feed')) return { json: { id: '42_888' } };
    if (m === 'GET' && u.includes('/42_888?')) return { json: { permalink_url: 'https://www.facebook.com/x/posts/888' } };
    return null;
  }, async (appels) => {
    const r = await publish(pkg, { channel: canalSansAttente });
    assert.equal(r.mediaId, '42_888');
    assert.deepEqual(appels.find((a) => a.url.endsWith('/feed')).corps, { message: dossier.facebook.texte, link: 'https://site.fr/truffe/?at_medium=social&at_campaign=fb-lien', published: 'true' });
    assert.ok(!appels.some((a) => a.url.endsWith('/comments') || a.url.endsWith('/photos')));
  });
});

test('bilan Telegram : Facebook hors du classement par format mêlé aux autres réseaux', () => {
  const t = '2026-11-24T08:00:00Z';
  const mesures = [
    { guid: 'a', channel: 'facebook', jalon: 7, likes: 1, publieLe: t },
    { guid: 'b', channel: 'threads', jalon: 7, likes: 30, publieLe: t },
  ];
  const history = [{ guid: 'a', channel: 'facebook', format: 'lien' }, { guid: 'b', channel: 'threads', format: 'reponse' }];
  const bilan = agreger(mesures, { history, jusqu: Date.parse('2026-12-01T00:00:00Z') });
  assert.deepEqual(Object.keys(bilan.parFormat), ['reponse'], '« lien » de Facebook n’est pas comparé aux formats de Threads');
});

test('page de l’équipe : le test annoncé tant qu’il n’est pas fini, sans rien d’interne', () => {
  const veille = testPublic(FB, paris('2026-11-22T21:00:00'));
  assert.deepEqual(veille, { reseau: 'facebook', du: '2026-11-23', au: '2026-12-13', jours: 21, jour: null, formats: ['photo', 'lien'], aujourdhui: null, demain: 'photo' });
  const j1 = testPublic(FB, paris('2026-11-23T10:00:00'));
  assert.equal(j1.jour, 1);
  assert.equal(j1.aujourdhui, 'photo');
  assert.equal(j1.demain, 'lien');
  assert.equal(testPublic(FB, paris('2026-12-13T22:00:00')).demain, null, 'dernier jour : pas de lendemain');
  assert.equal(testPublic(FB, paris('2026-12-14T08:00:00')), null, 'fini : la section disparaît');
  assert.equal(testPublic({ ...FB, test: { ...FB.test, actif: false } }, paris('2026-11-25T10:00:00')), null);
});
