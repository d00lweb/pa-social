import { test } from 'node:test';
import assert from 'node:assert/strict';
test('post disparu chez le réseau : le jalon est clos, pas retenté sans fin', async () => {
  const { collecter, aRelever } = await import('../src/measure/collect.mjs');
  const { parPost } = await import('../src/measure/rapport.mjs');
  // 24/09/2026 : « Object with ID '18071283440738292' does not exist » repartait à chaque passage.
  const mesures = [
    { guid: 'g', channel: 'instagram', jalon: 1, publieLe: '2026-09-20T10:00:00Z', likes: 12 },
    { guid: 'disparu', channel: 'instagram', jalon: 1, publieLe: '2026-09-20T10:00:00Z', introuvable: true },
  ];
  const history = [
    { guid: 'g', channel: 'instagram', mediaId: '1', at: '2026-09-20T10:00:00Z' },
    { guid: 'disparu', channel: 'instagram', mediaId: '2', at: '2026-09-20T10:00:00Z' },
  ];
  const restant = aRelever(history, mesures, Date.parse('2026-09-24T10:00:00Z')).filter((r) => r.jalon === 1);
  assert.equal(restant.length, 0, 'le jalon clos ne revient pas');
  // et il ne pèse pas sur les moyennes : aucun chiffre à en tirer
  assert.deepEqual(parPost(mesures).map((m) => m.guid), ['g']);
  assert.equal(typeof collecter, 'function');
});

// 06/10/2026 : Instagram annonçait 17 à 33 commentaires par post, presque tous du spam qu'il avait
// lui-même caché, et Threads et Bluesky comptaient comme « réponse » le lien posté par le robot.
// Le classement du mois et la page de l'équipe en étaient faussés.
const ESPION = 'Ne jamais chercher k​e‌h‍9⁠2.c⁠o͏m sur s‌a‍f⁠a͏r​i 💀';

test('commentaires : seuls ceux des lecteurs comptent', async () => {
  const { commentairesDeLecteurs } = await import('../src/measure/collect.mjs');
  const liste = [
    { texte: 'Quelle heure ?', date: '2026-10-01T10:00:00Z' },
    { texte: '😍😍', date: '2026-10-01T11:00:00Z' },
    { texte: ESPION, date: '2026-10-01T12:00:00Z' },
    { texte: '👉 Tous les détails : https://passion-aquitaine.ouest-france.fr/x', date: '2026-10-01T09:00:00Z', nous: true },
    { texte: 'Commentaire masqué par la page', date: '2026-10-01T13:00:00Z', masque: true },
    { texte: 'Écrit après le relevé', date: '2026-10-03T10:00:00Z' },
  ];
  assert.equal(commentairesDeLecteurs(liste), 3, 'spam, réponse du robot et commentaire masqué exclus');
  assert.equal(commentairesDeLecteurs(liste, { avant: Date.parse('2026-10-02T00:00:00Z') }), 2, 'rien d’écrit après le relevé');
  assert.equal(commentairesDeLecteurs([]), 0);
});

test('anciens relevés : commentaires recomptés à leur date, likes et vues intacts', async () => {
  const { recompter, VERSION_COMPTAGE } = await import('../src/measure/collect.mjs');
  const mesures = [
    { guid: 'a', channel: 'instagram', mediaId: 'ig1', jalon: 1, releveLe: '2026-10-02T00:00:00Z', likes: 4, commentaires: 26 },
    { guid: 'a', channel: 'threads', mediaId: 'th1', jalon: 1, releveLe: '2026-10-02T00:00:00Z', likes: 1, commentaires: 1, vues: 256 },
    { guid: 'b', channel: 'instagram', mediaId: 'disparu', jalon: 1, releveLe: '2026-10-02T00:00:00Z', likes: 2, commentaires: 3 },
    { guid: 'c', channel: 'instagram', mediaId: 'ig3', jalon: 7, releveLe: '2026-10-02T00:00:00Z', likes: 9, commentaires: 2, v: VERSION_COMPTAGE },
  ];
  const lire = {
    instagram: async ({ mediaId }) => {
      if (mediaId === 'disparu') throw new Error("Object with ID 'disparu' does not exist");
      return { likes: 99, commentairesBruts: 26, liste: [{ texte: ESPION, date: '2026-10-01T10:00:00Z' }, { texte: 'Superbe lieu', date: '2026-10-01T11:00:00Z' }, { texte: 'Après coup', date: '2026-10-05T11:00:00Z' }] };
    },
    threads: async () => ({ likes: 7, commentairesBruts: 1, vues: 900, liste: [{ texte: '👉 Tous les détails : https://…', date: '2026-10-01T09:00:00Z', nous: true }] }),
  };
  assert.equal(await recompter(mesures, [], { lire }), 3, 'le relevé déjà au nouveau comptage n’est pas relu');
  assert.deepEqual(mesures.map((m) => [m.commentaires, m.commentairesBruts, m.v]), [[1, 26, 2], [0, 1, 2], [null, 3, 2], [2, undefined, 2]]);
  assert.equal(mesures[0].likes, 4, 'les likes du relevé d’origine restent');
  assert.equal(mesures[1].vues, 256, 'les vues aussi');
});
