import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reparer } from '../src/brain/dossier.mjs';

// Le 18/09/2026, un article est parti avec la description brute du flux sur cinq réseaux :
// l'IA avait répondu trois fois, refusée deux fois pour un surlignage trop long et une fois
// pour un point devant un emoji. Ces défauts se réparent ; ils ne doivent plus tout emporter.

const dossier = () => ({
  rubrique: 'Périgord',
  visuel: {
    titre: 'Grotte, rivière, châteaux : cette course de 80 km traverse l’histoire cachée du Périgord',
    surlignage: 'traverse l’histoire cachée du Périgord',
    description: 'Une course de 80 km.',
    texte_alternatif: 'Périgord : une course',
  },
  instagram: { texte: 'Une course de 80 km. 🏃', hashtags: ['#Périgord'] },
  facebook: { texte: 'Une course de 80 km 🏃' },
  bluesky: { texte: 'Une course de 80 km. 🏃', hashtag: '#Périgord' },
  threads: { texte: 'Une course de 80 km. 🏃', sujet: 'Périgord' },
  x: { texte: 'Une course de 80 km 🏃' },
});

test('surlignage trop long : recalculé au lieu de tout jeter', () => {
  const { repare, faits } = reparer(dossier(), ['surlignage trop long (3 mots et 24 caractères max)']);
  assert.ok(faits.includes('surlignage'));
  assert.notEqual(repare.visuel.surlignage, dossier().visuel.surlignage);
  assert.ok([...repare.visuel.surlignage].length <= 24, `« ${repare.visuel.surlignage} » tient dans la limite`);
  assert.ok(repare.visuel.titre.includes(repare.visuel.surlignage), 'copié exactement depuis le titre');
});

test('point avant un emoji : retiré sur tous les réseaux concernés', () => {
  const { repare, faits } = reparer(dossier(), ['threads : pas de point juste avant un emoji']);
  assert.ok(faits.includes('threads') && faits.includes('instagram') && faits.includes('bluesky'));
  for (const net of ['instagram', 'bluesky', 'threads']) {
    assert.doesNotMatch(repare[net].texte, /[.…]\s*\p{Extended_Pictographic}/u, `${net} nettoyé`);
    assert.match(repare[net].texte, /80 km 🏃$/u, `${net} garde son texte`);
  }
  assert.equal(repare.facebook.texte, dossier().facebook.texte, 'un texte déjà correct n’est pas touché');
});

test('les autres refus ne sont pas réparés : le repli reste la règle', () => {
  const { faits } = reparer(dossier(), ['instagram : chiffre absent de la source', 'x : formule d’appel à l’engagement interdite']);
  assert.equal(faits.length, 0, 'invention et appât ne se réparent pas mécaniquement');
});
