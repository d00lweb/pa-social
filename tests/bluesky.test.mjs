import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFacets, postText, modeFor, replyTextFor, mentionFacets, LINK_LABEL } from '../src/channels/bluesky.mjs';

const bytes = (s) => new TextEncoder().encode(s).length;

test('facettes : hashtags et lien en octets UTF-8 (accents, emojis)', () => {
  const text = `🐝 À #Bordeaux, l’été #Béarn\n➡️ ${LINK_LABEL}`;
  const facets = buildFacets(text, 'https://site.fr/a', LINK_LABEL);
  const [bdx, bearn, link] = facets;
  assert.equal(bdx.features[0].tag, 'Bordeaux');
  assert.equal(bdx.index.byteStart, bytes('🐝 À '));
  assert.equal(bdx.index.byteEnd, bytes('🐝 À #Bordeaux'));
  assert.equal(bearn.features[0].tag, 'Béarn');
  assert.equal(link.features[0].uri, 'https://site.fr/a');
  assert.equal(link.index.byteStart, bytes(`🐝 À #Bordeaux, l’été #Béarn\n➡️ `));
  assert.equal(link.index.byteEnd, bytes(text));
});

test('formats : les 3 se répartissent équitablement et restent stables par article', () => {
  const modes = Array.from({ length: 600 }, (_, i) => modeFor(`https://site.fr/?p=${i}`));
  for (const f of ['card', 'image', 'reply']) {
    const n = modes.filter((m) => m === f).length;
    assert.ok(n > 140 && n < 260, `${f} : ${n}`);
  }
  assert.equal(modeFor('https://site.fr/?p=7'), modeFor('https://site.fr/?p=7'));
});

test('mention : facette sur le pseudo, rien si le compte n’existe pas', async () => {
  const text = 'Au @musee-aquitaine.bsky.social, le monument dédié à Montaigne 🏛️';
  const [facet, ...reste] = await mentionFacets(text, async (h) => (h === 'musee-aquitaine.bsky.social' ? 'did:plc:abc' : null));
  assert.equal(reste.length, 0);
  assert.equal(facet.features[0].$type, 'app.bsky.richtext.facet#mention');
  assert.equal(facet.features[0].did, 'did:plc:abc');
  assert.equal(facet.index.byteStart, bytes('Au '));
  assert.equal(facet.index.byteEnd, bytes('Au @musee-aquitaine.bsky.social'));
  // compte introuvable : aucune facette, la mention resterait du texte inerte
  assert.deepEqual(await mentionFacets(text, async () => null), []);
});

test('réponse : formule tournante + lien cliquable, sans lien dans le post', () => {
  const dossier = { bluesky: { texte: 'À Bordeaux, le matrimoine revient 🎭', hashtag: '#Bordeaux' } };
  assert.equal(postText(dossier, 'reply'), 'À #Bordeaux, le matrimoine revient 🎭');
  const a = replyTextFor({ guid: 'g1', link: 'https://site.fr/a' });
  assert.match(a, /^\S+ .+ https:\/\/site\.fr\/a$/u);
  assert.equal(a, replyTextFor({ guid: 'g1', link: 'https://site.fr/a' }), 'stable par article');
  const [facet] = buildFacets(a);
  assert.equal(facet.features[0].uri, 'https://site.fr/a');
  assert.equal(facet.index.byteEnd, bytes(a));
});

test('texte : lien ajouté seulement en mode image', () => {
  const dossier = { bluesky: { texte: 'À Bordeaux, le matrimoine revient 🎭', hashtag: '#Bordeaux' } };
  assert.equal(postText(dossier, 'card'), 'À #Bordeaux, le matrimoine revient 🎭');
  assert.equal(postText(dossier, 'image'), `À #Bordeaux, le matrimoine revient 🎭\n➡️ ${LINK_LABEL}`);
});
