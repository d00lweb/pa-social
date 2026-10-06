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

// 06/10/2026 : deux ou trois hashtags au plus, posés sur les mots du texte — jamais une ligne de
// hashtags en plus (choix de l'équipe). Textes réels des dossiers de fin septembre - début octobre.
test('hashtags dans le texte : le lieu, le territoire, le thème, trois au plus', async () => {
  const { composeBluesky } = await import('../src/brain/compose.mjs');
  const d = (texte, extra) => ({ bluesky: { texte, hashtag: extra.hashtag }, ...extra });
  assert.equal(
    composeBluesky(d('🌧️ Pourquoi guetter la pluie cet automne autour de Bordeaux ? Parce que les premières averses relancent la traque aux champignons en Gironde.', { hashtag: '#Bordeaux', commune: 'Bordeaux', rubrique: 'Bordeaux', lieuSource: { departement: 'Gironde' }, domaines: ['mycologie', 'nature'] })),
    '🌧️ Pourquoi guetter la pluie cet automne autour de #Bordeaux ? Parce que les premières averses relancent la traque aux champignons en #Gironde.',
  );
  // plusieurs mots s'assemblent, sans accents
  assert.equal(
    composeBluesky(d('En Nouvelle-Aquitaine, aucun département ne fait mieux que les Deux-Sèvres en matière de fécondité 📊', { hashtag: '#NouvelleAquitaine', rubrique: 'Deux-Sèvres', lieuSource: { departement: 'Deux-Sèvres' }, domaines: ['démographie'] })),
    'En #NouvelleAquitaine, aucun département ne fait mieux que les #DeuxSevres en matière de fécondité 📊',
  );
  // le thème ensuite, sur le mot tel qu'écrit
  assert.equal(
    composeBluesky(d('🎤 Jusqu’où peut aller un festival né il y a à peine un an ? À Bègles, le Green Paradize Festival revient déjà.', { hashtag: '#Bègles', commune: 'Bègles', rubrique: 'Bordeaux', lieuSource: { departement: 'Gironde' }, domaines: ['festival', 'musique'] })),
    '🎤 Jusqu’où peut aller un #festival né il y a à peine un an ? À #Bègles, le Green Paradize Festival revient déjà.',
  );
  // trois au plus, même quand le texte en offre davantage
  const plein = composeBluesky(d('À Anglet, au Pays basque, dans les Pyrénées-Atlantiques, le patrimoine et le surf se rencontrent.', { hashtag: '#PaysBasque', commune: 'Anglet', rubrique: 'Pays basque', lieuSource: { departement: 'Pyrénées-Atlantiques' }, domaines: ['patrimoine', 'surf'] }));
  assert.equal(plein, 'À #Anglet, au #PaysBasque, dans les #PyreneesAtlantiques, le patrimoine et le surf se rencontrent.');
  assert.ok(!plein.includes('\n'), 'jamais de ligne en plus');
});

test('hashtags : jamais collés à une apostrophe ou à un tiret, ni dans un nom que la mention remplacera', async () => {
  const { composeBluesky, taguerDansLeTexte } = await import('../src/brain/compose.mjs');
  assert.equal(taguerDansLeTexte('Le piment d’Espelette sèche.', 'Espelette'), null, 'pas de « d’#Espelette »');
  assert.equal(taguerDansLeTexte('En Haute-Vienne, la forêt.', 'Vienne'), null, 'pas de « Haute-#Vienne »');
  assert.equal(taguerDansLeTexte('En Haute-Vienne, la forêt.', 'Haute-Vienne'), 'En #HauteVienne, la forêt.');
  assert.equal(taguerDansLeTexte('À Périgueux, la cathédrale.', 'Périgueux'), 'À #Périgueux, la cathédrale.', 'l’orthographe du texte, jamais un #Perigueux inventé');
  // 29/09/2026 : « Le #Hasparren Athletic Club » aurait empêché la mention du club sur Bluesky
  const hasparren = {
    bluesky: { texte: 'Le Hasparren Athletic Club forme ses joueurs : à Hasparren, on mise sur les jeunes.', hashtag: '#Hasparren' },
    commune: 'Hasparren',
    comptes: { bluesky: [{ nom: 'Hasparren Athletic Club', handle: 'hasparrenac.bsky.social' }] },
  };
  assert.equal(composeBluesky(hasparren), 'Le Hasparren Athletic Club forme ses joueurs : à #Hasparren, on mise sur les jeunes.');
  // aucun mot ne s'y prête : le hashtag de lieu de l'IA ferme le texte, sur la même ligne
  assert.equal(composeBluesky({ bluesky: { texte: 'Le piment sèche au soleil.', hashtag: '#PaysBasque' }, commune: 'Espelette' }), 'Le piment sèche au soleil. #PaysBasque');
});
