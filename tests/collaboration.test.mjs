import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collaborateurs, creerCarrousel, COLLABORATEURS_MAX } from '../src/channels/instagram.mjs';

// 06/10/2026 : le compte au cœur de l'article est invité à cosigner le carrousel Instagram. S'il
// accepte, le post paraît aussi sur son profil. Meta l'admet pour les carrousels, trois au plus.

const c = (handle, echelon, role) => ({ handle, echelon, role });

test('invités : le sujet lui-même, deux au plus — ni les artistes, ni la ville', () => {
  // Bègles : le festival est le sujet ; Cerrone et Morcheeba se produisent (acteurs) ; la ville est tagguée
  const begles = [
    c('greenparadizefest', 'sujet', 'sujet'),
    c('cerroneofficial', 'sujet', 'acteur'),
    c('morcheebaband', 'sujet', 'acteur'),
    c('villedebegles', 'commune', 'commune'),
  ];
  assert.deepEqual(collaborateurs(begles), ['greenparadizefest']);
  assert.deepEqual(collaborateurs([c('a', 'sujet', 'sujet'), c('b', 'sujet', 'sujet'), c('d', 'sujet', 'sujet')]), ['a', 'b'], `${COLLABORATEURS_MAX} au plus`);
  assert.deepEqual(collaborateurs([c('villehendaye64700', 'commune', 'commune')]), [], 'Hendaye sans compte pour le château : personne n’est invité');
  assert.deepEqual(collaborateurs(), []);
});

// Graphe simulé : refuse ce qu'on lui dit de refuser, et note chaque essai
function graphe({ refuse = [] } = {}) {
  const essais = [];
  return {
    essais,
    async createCarousel(children, caption, { locationId, collaborators } = {}) {
      essais.push({ locationId: locationId ?? null, collaborators: collaborators ?? [] });
      if (refuse.includes('collaborators') && collaborators?.length) throw new Error('Invalid collaborator');
      if (refuse.includes('location') && locationId) throw new Error('location_id is not a valid location page ID');
      return 'carrousel-1';
    },
  };
}

test('une collaboration ou un lieu refusés ne bloquent jamais le post', async () => {
  const journal = [];
  const log = (l) => journal.push(l);

  const ok = await creerCarrousel(graphe(), ['i1', 'i2'], 'texte', { locationId: '1234567890123', collaborators: ['greenparadizefest'] }, log);
  assert.deepEqual(ok, { id: 'carrousel-1', collaborateurs: ['greenparadizefest'] });

  // invitation refusée : on la retire, le lieu reste
  const g1 = graphe({ refuse: ['collaborators'] });
  const sansCollab = await creerCarrousel(g1, ['i1'], 'texte', { locationId: '1234567890123', collaborators: ['prive'] }, log);
  assert.deepEqual(sansCollab, { id: 'carrousel-1', collaborateurs: [] }, 'aucune invitation comptée si Meta l’a refusée');
  assert.deepEqual(g1.essais.map((e) => [e.locationId, e.collaborators.length]), [['1234567890123', 1], ['1234567890123', 0]]);

  // invitation et lieu refusés : le post part nu, mais il part
  const g2 = graphe({ refuse: ['collaborators', 'location'] });
  assert.deepEqual(await creerCarrousel(g2, ['i1'], 'texte', { locationId: '1', collaborators: ['prive'] }, log), { id: 'carrousel-1', collaborateurs: [] });
  assert.equal(g2.essais.length, 3);
  assert.ok(journal.some((l) => /Collaboration abandonnée/.test(l)) && journal.some((l) => /Lieu abandonné/.test(l)));

  // sans invitation ni lieu, une erreur réelle remonte : elle ne doit pas être masquée
  const g3 = { async createCarousel() { throw new Error('Meta en panne'); } };
  await assert.rejects(creerCarrousel(g3, ['i1'], 'texte', {}, log), /Meta en panne/);
});
