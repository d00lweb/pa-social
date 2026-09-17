import { readFileSync } from 'node:fs';
import { loadJson, saveJson } from '../core/state.mjs';
import { config, fromRoot, enabledChannels } from '../core/config.mjs';
import { countToday, dayKey } from '../core/scheduler.mjs';

// Instantané lu par pilotage.html : l'état réel du robot, publié à chaque passage.
// Volontairement compact — la page le télécharge à chaque ouverture.
const TZ = config.timezone;
const OUVERTS = ['pending', 'awaiting'];

const titre = (item) => item?.article?.title ?? '';

// Expiration connue des jetons : Meta ne la prolonge pas tout seul, Threads si.
function jetons() {
  let meta = null;
  try {
    meta = JSON.parse(readFileSync(fromRoot('state/jetons.json'), 'utf8'));
  } catch {
    meta = null;
  }
  return meta;
}

export function construire({ history, queue, mesures = [], rapports = [], maintenant = Date.now() }) {
  const actifs = enabledChannels().map((c) => c.id);

  const reseaux = Object.fromEntries(
    Object.entries(config.channels).map(([id, canal]) => {
      const publies = history.filter((e) => e.channel === id);
      return [id, {
        actif: actifs.includes(id),
        maxParJour: canal.maxPerDay ?? null,
        aujourdhui: countToday(history, id, maintenant, TZ),
        total: publies.length,
        dernier: publies.at(-1)?.at ?? null,
      }];
    }),
  );

  // Les derniers articles réellement publiés, avec ce qui est parti sur chaque réseau :
  // c'est ce que la page affiche en aperçu, à la place des anciennes planches de démonstration.
  const articles = derniersArticles(history, 6);

  const file = queue
    .filter((q) => OUVERTS.includes(q.status))
    .sort((a, b) => a.dueAt - b.dueAt)
    .map((q) => ({ channel: q.channel, dueAt: new Date(q.dueAt).toISOString(), titre: titre(q) }));

  // Ce qui a échoué ou a été bloqué reste visible une semaine : c'est ce qu'on veut voir en premier
  const alertes = queue
    .filter((q) => ['blocked', 'failed'].includes(q.status))
    .map((q) => ({ channel: q.channel, statut: q.status, titre: titre(q), raison: q.lastError ?? 'garde-fou', quand: new Date(q.dueAt).toISOString() }));

  return {
    genereLe: new Date(maintenant).toISOString(),
    jour: dayKey(maintenant, TZ),
    reseaux,
    articles,
    file,
    alertes,
    mesures: resume(mesures),
    rapports,
    jetons: jetons(),
  };
}

// Regroupe l'historique par article, du plus récent au plus ancien, avec l'aperçu de chaque réseau
export function derniersArticles(history, combien = 6) {
  const parArticle = new Map();
  for (const e of history) {
    if (!e.at) continue;
    const a = parArticle.get(e.guid) ?? { guid: e.guid, titre: e.titre ?? '', lien: e.lien ?? null, at: e.at, reseaux: {} };
    a.titre ||= e.titre ?? '';
    a.lien ??= e.lien ?? null;
    if (new Date(e.at) > new Date(a.at)) a.at = e.at;
    if (e.apercu) a.reseaux[e.channel] = { ...e.apercu, publieLe: e.at };
    parArticle.set(e.guid, a);
  }
  return [...parArticle.values()]
    .filter((a) => Object.keys(a.reseaux).length)
    .sort((x, y) => new Date(y.at) - new Date(x.at))
    .slice(0, combien);
}

// Résumé léger : de quoi afficher un classement, pas toute la matière
function resume(mesures) {
  const j7 = mesures.filter((m) => m.jalon === 7);
  const total = (m) => (m.likes ?? 0) + (m.commentaires ?? 0) + (m.partages ?? 0);
  return {
    releves: mesures.length,
    parReseau: Object.fromEntries(
      [...new Set(j7.map((m) => m.channel))].map((c) => {
        const liste = j7.filter((m) => m.channel === c);
        const moyenne = liste.reduce((n, m) => n + total(m), 0) / (liste.length || 1);
        return [c, { posts: liste.length, interactionsMoyennes: Math.round(moyenne * 10) / 10 }];
      }),
    ),
  };
}

export async function ecrire(contexte) {
  const [history, queue, mesures] = await Promise.all([
    contexte.history ? Promise.resolve(contexte.history) : loadJson('published.json', []),
    contexte.queue ? Promise.resolve(contexte.queue) : loadJson('queue.json', []),
    loadJson('mesures.json', []),
  ]);
  const rapports = await loadJson('rapports/index.json', []);
  const instantane = construire({ history, queue, mesures, rapports, maintenant: contexte.now ?? Date.now() });
  await saveJson('pilotage.json', instantane);
  return instantane;
}
