import { readFileSync } from 'node:fs';
import { loadJson, saveJson } from '../core/state.mjs';
import { config, fromRoot, enabledChannels } from '../core/config.mjs';
import { countToday, dayKey } from '../core/scheduler.mjs';

// Instantané lu par pilotage.html : l'état réel du robot, publié à chaque passage.
// Volontairement compact — la page le télécharge à chaque ouverture.
const TZ = config.timezone;
const OUVERTS = ['pending', 'awaiting'];

const titre = (item) => item?.article?.title ?? '';

// Le robot ne tourne qu'aux passages du cron o2switch, à :00 et :20. Une publication due entre
// deux passages ne peut pas partir avant le suivant : la page doit annoncer l'heure réelle, pas
// l'heure théorique de la file. Un post dû à 12:22 sort à 13:00, pas à 12:22.
// Les minutes sont identiques dans tout fuseau décalé d'un nombre entier d'heures : on peut donc
// raisonner sur l'horodatage sans convertir. Le cron GitHub peut déclencher plus tôt, mais il est
// trop irrégulier pour qu'on promette son heure.
export const PASSAGES = [0, 20];

export function prochainPassage(dueAt, maintenant = Date.now()) {
  const base = Math.max(new Date(dueAt).getTime(), maintenant);
  const depart = new Date(base);
  depart.setSeconds(0, 0);
  for (let i = 0; i <= 60; i++) {
    const essai = new Date(depart.getTime() + i * 60_000);
    if (PASSAGES.includes(essai.getUTCMinutes()) && essai.getTime() >= base) return essai;
  }
  return new Date(base);
}

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
    .map((q) => ({
      channel: q.channel,
      dueAt: new Date(q.dueAt).toISOString(),
      // heure à laquelle le post peut réellement partir, l'échéance seule étant trompeuse
      prochainPassage: prochainPassage(q.dueAt, maintenant).toISOString(),
      titre: titre(q),
    }));

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
