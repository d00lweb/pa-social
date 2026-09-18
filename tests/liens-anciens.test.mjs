import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aCompleter, completerLiens } from '../src/measure/liens.mjs';
import { fusionner } from '../scripts/fusion-etat.mjs';
import { lireNombre, evolution } from '../src/measure/abonnes.mjs';

// Publications antérieures au 18/09/2026 : le lien direct du post est retrouvé à partir de
// l'identifiant conservé, une seule fois, et survit à la fusion de l'état entre deux passages.

const historique = () => [
  { guid: 'a', channel: 'bluesky', at: '2026-09-16T06:21:28Z', mediaId: 'at://did:plc:abc/app.bsky.feed.post/3mvmiqoystk23' },
  { guid: 'a', channel: 'instagram', at: '2026-09-16T07:09:13Z', mediaId: '17922898128204983' },
  { guid: 'a', channel: 'x', at: '2026-09-16T08:00:00Z', mediaId: 'kit-telegram' },
  { guid: 'b', channel: 'facebook', at: '2026-09-18T11:22:43Z', mediaId: '227437307428711_1', lienPost: 'https://www.facebook.com/p/1' },
];

test('seules les publications sans lien, avec un vrai identifiant, sont à compléter', () => {
  assert.deepEqual(aCompleter(historique()).map((e) => e.channel), ['bluesky', 'instagram'], 'ni le kit X, ni ce qui a déjà son lien');
});

test('lien retrouvé, un seul essai par publication', async () => {
  const h = historique();
  const appels = [];
  const lecteurs = {
    bluesky: async (id) => { appels.push(id); return `https://bsky.app/profile/passion-aquitaine.ouest-france.fr/post/${id.split('/').pop()}`; },
    instagram: async () => { appels.push('ig'); throw new Error('indisponible'); },
  };
  assert.equal(await completerLiens(h, { lecteurs, log: () => {} }), 1);
  assert.equal(h[0].lienPost, 'https://bsky.app/profile/passion-aquitaine.ouest-france.fr/post/3mvmiqoystk23');
  assert.equal(h[1].lienPost, undefined);
  await completerLiens(h, { lecteurs, log: () => {} });
  assert.equal(appels.length, 2, 'pas de nouvel essai au passage suivant');
});

test('fusion de l’état : un lien retrouvé complète la fiche sans rien remplacer', () => {
  const distant = [{ guid: 'a', channel: 'bluesky', at: '2026-09-16T06:21:28Z', mediaId: 'at://x', titre: 'Titre' }];
  const local = [{ guid: 'a', channel: 'bluesky', at: '2026-09-16T06:21:28Z', mediaId: 'at://x', titre: 'Autre', lienPost: 'https://bsky.app/p', lienCherche: true }];
  const [fiche] = fusionner({ distant, local }).historique;
  assert.equal(fiche.lienPost, 'https://bsky.app/p');
  assert.equal(fiche.titre, 'Titre', 'la version qui fait foi garde ses valeurs');
});

test('abonnés X saisis à la main : lecture du nombre et évolution', () => {
  assert.equal(lireNombre('2 940'), 2940);
  assert.equal(lireNombre('2940'), 2940);
  assert.equal(lireNombre('2.940'), 2940);
  assert.equal(lireNombre('deux mille'), null);
  assert.equal(lireNombre(''), null);
  const releves = { '2026-09-18': { facebook: 1, x: 2940 }, '2026-09-19': { facebook: 2 }, '2026-09-25': { x: 2990 } };
  assert.deepEqual(evolution(releves, 'x', '2026-09-18', '2026-09-25'), { debut: 2940, fin: 2990, gain: 50, pct: 1.7, depuis: '2026-09-18', au: '2026-09-25' });
});
