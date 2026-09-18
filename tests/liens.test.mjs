import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lienPublic } from '../src/channels/bluesky.mjs';

// L'avis Telegram porte un bouton vers la publication. Bluesky est le seul réseau dont le
// lien se déduit de l'identifiant du post, sans appel réseau : autant le vérifier ici.

test('Bluesky : le lien public se construit à partir de l’identifiant du post', () => {
  const uri = 'at://did:plc:ypqeiof554p2x7wxn5syoq7o/app.bsky.feed.post/3mvrm5zanwc2i';
  assert.equal(
    lienPublic(uri, 'passion-aquitaine.ouest-france.fr'),
    'https://bsky.app/profile/passion-aquitaine.ouest-france.fr/post/3mvrm5zanwc2i',
  );
});

test('Bluesky : rien plutôt qu’un lien bancal', () => {
  assert.equal(lienPublic('', 'passion-aquitaine.ouest-france.fr'), null, 'pas d’identifiant');
  assert.equal(lienPublic('at://did/app.bsky.feed.post/abc', ''), null, 'pas de compte');
  assert.equal(lienPublic(null, 'passion-aquitaine.ouest-france.fr'), null);
});
