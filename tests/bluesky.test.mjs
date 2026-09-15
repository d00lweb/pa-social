import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFacets, postText, modeFor, LINK_LABEL } from '../src/channels/bluesky.mjs';

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

test('mode : environ 1 article sur 5 en image, stable par article', () => {
  const modes = Array.from({ length: 400 }, (_, i) => modeFor(`https://site.fr/?p=${i}`));
  const images = modes.filter((m) => m === 'image').length;
  assert.ok(images > 50 && images < 110, `images : ${images}`);
  assert.equal(modeFor('https://site.fr/?p=7'), modeFor('https://site.fr/?p=7'));
});

test('texte : lien ajouté seulement en mode image', () => {
  const dossier = { bluesky: { texte: 'À Bordeaux, le matrimoine revient 🎭', hashtag: '#Bordeaux' } };
  assert.equal(postText(dossier, 'card'), 'À #Bordeaux, le matrimoine revient 🎭');
  assert.equal(postText(dossier, 'image'), `À #Bordeaux, le matrimoine revient 🎭\n➡️ ${LINK_LABEL}`);
});
