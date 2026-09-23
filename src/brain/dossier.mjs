import { readFileSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fromRoot } from '../core/config.mjs';
import { frenchTypography, pickHighlight } from './editorial.mjs';
import { resolvePlace, candidateZones, placeNames } from './geo.mjs';
import { checkDossier } from './guards.mjs';
import { fallbackDossier, sansDate } from './fallback.mjs';
import { signalerIaIndisponible, verifierBudget } from './couts.mjs';
import { nextAngles, nextEmojiPositions } from './memory.mjs';

const ed = JSON.parse(readFileSync(fromRoot('config/editorial.json'), 'utf8'));
const system = readFileSync(fromRoot('prompts/editorial.md'), 'utf8');
const CACHE = fromRoot('.cache', 'dossiers');
const MAX_ATTEMPTS = 3;

const frDate = (ms) => new Date(ms).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const cleanCategories = (cats) => cats.filter((c) => !new RegExp(ed.internalCategoryPattern, 'i').test(c));

// Typographie française appliquée à tous les textes produits
function typeset(d) {
  const t = (s) => frenchTypography(String(s).replace(/'/g, '’'));
  return {
    ...d,
    rubrique: d.rubrique.trim().replace(/'/g, '’'),
    visuel: { titre: t(d.visuel.titre), surlignage: t(d.visuel.surlignage), description: t(d.visuel.description ?? ''), texte_alternatif: t(d.visuel.texte_alternatif) },
    instagram: { ...d.instagram, texte: t(d.instagram.texte) },
    // Facebook : jamais de date dans le texte. Elle ouvre sur l'information la moins engageante,
    // et la carte d'aperçu comme l'article la donnent déjà. Retirée quelle que soit sa provenance.
    facebook: { ...d.facebook, texte: sansDate(t(d.facebook.texte)) },
    bluesky: { ...d.bluesky, texte: t(d.bluesky.texte) },
    threads: { texte: t(d.threads.texte), sujet: String(d.threads.sujet ?? '').trim().replace(/^#/, '') },
    x: { texte: t(d.x.texte) },
  };
}

// Défauts mécaniques réparables. Jeter cinq textes bien écrits parce qu'un mot surligné dépasse
// de deux caractères est disproportionné : on corrige soi-même, puis on repasse les contrôles.
// Tout le reste (invention, répétition, appât, emojis) continue de provoquer le repli sur les règles.
export function reparer(dossier, problems) {
  const repare = { ...dossier, visuel: { ...dossier.visuel } };
  const faits = [];

  if (problems.some((p) => p.includes('surlignage'))) {
    const { highlight } = pickHighlight(repare.visuel.titre, { avoid: [repare.rubrique] });
    if (highlight && highlight !== repare.visuel.surlignage) {
      repare.visuel.surlignage = highlight;
      faits.push('surlignage');
    }
  }

  if (problems.some((p) => p.includes('point juste avant un emoji'))) {
    for (const net of ['instagram', 'facebook', 'bluesky', 'threads', 'x']) {
      const texte = repare[net]?.texte;
      if (!texte) continue;
      const propre = texte.replace(/[.…]\s*(\p{Extended_Pictographic})/gu, ' $1').replace(/ {2,}/g, ' ');
      if (propre !== texte) {
        repare[net] = { ...repare[net], texte: propre };
        faits.push(net);
      }
    }
  }
  return { repare, faits };
}

// Dossier de publication d'un article : IA contrôlée, sinon règles de secours
export async function buildDossier(article, { memory, useCache = false, log = console.log } = {}) {
  const place = resolvePlace(article);
  const angles = nextAngles(memory, ed.angles, ed.networks);
  const emojiPlacement = nextEmojiPositions(memory, ed.emojiPositions, ed.networks);
  // Questions limitées (anti-appât) : angle « question », ou 1 article sur N pour Facebook et Threads
  const questions = Object.fromEntries(
    ed.networks.map((n) => [n, angles[n] === 'question intrigante' || (['facebook', 'threads'].includes(n) && memory.angleIndex % ed.questionEvery === 0)]),
  );
  const key = createHash('sha1').update(JSON.stringify([ed.promptVersion, article.guid, article.title, article.description])).digest('hex').slice(0, 16);
  const cacheFile = fromRoot('.cache', 'dossiers', `${key}.json`);

  if (useCache) {
    try {
      const cached = JSON.parse(await readFile(cacheFile, 'utf8'));
      log(`   Dossier (cache ${cached.source}) : ${article.title}`);
      const ready = typeset(cached);
      ready.cached = true; // aucun appel IA facturé
      return ready;
    } catch {
      // pas en cache
    }
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    log('   IA : pas de clé API, règles de secours');
    return fallbackDossier(article);
  }

  // Filet de dépense : au-delà du budget du mois, on n'appelle plus le rédacteur. L'article est
  // alors reporté comme lors d'une panne (jusqu'à 6 h), puis publié avec les règles s'il le faut.
  const budget = await verifierBudget({ now: Date.now() });
  if (budget.depasse) {
    log(`   IA : budget du mois atteint (${budget.depense.toFixed(2)} $ sur ${budget.budget} $), règles de secours`);
    return { ...fallbackDossier(article), raison: 'budget-atteint' };
  }

  const { askEditor } = await import('./ai.mjs');
  const source = [article.title, article.description, cleanCategories(article.categories).join(', '), frDate(article.date), new Date(article.date).toISOString().slice(0, 10)].join('\n');
  const payload = {
    article: { titre: article.title, description: article.description, categories: cleanCategories(article.categories), date: frDate(article.date) },
    lieu_detecte: place?.name ?? null,
    zones_possibles: candidateZones(article, place),
    angles,
    questions_autorisees: questions,
    emojis_recents: memory.emojis ?? {},
    emoji_placement: emojiPlacement,
    // Les accroches récentes ne servent qu'à éviter de se répéter : les 3 dernières, réduites à
    // leur ouverture, suffisent au rédacteur. La mémoire complète (10 par réseau) reste utilisée
    // localement par le contrôle de similarité, qui refuse un texte trop proche d'un ancien.
    // Envoyer les 50 textes entiers coûtait 3 055 jetons par appel, soit 1,5 centime.
    dernieres_accroches: Object.fromEntries(
      Object.entries(memory.recent ?? {}).map(([net, textes]) => [net, textes.slice(-3).map((t) => t.split('\n')[0].slice(0, 90))]),
    ),
  };

  let corrections = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let result;
    try {
      result = await askEditor({ system, payload: corrections ? { ...payload, corrections } : payload, model: ed.model, effort: ed.effort });
    } catch (err) {
      log(`   IA indisponible (${err.message}) : règles de secours`);
      // prévenir une fois par jour : sans rédacteur, les cinq réseaux publient une copie dégradée
      await signalerIaIndisponible(err.message, { now: Date.now() }).catch(() => {});
      return { ...fallbackDossier(article), raison: 'ia-indisponible' };
    }
    const controle = (d) => checkDossier(d, { ...ed, source, knownNames: [...ed.knownNames, ...placeNames(), ...ed.themes.map((t) => t.rubrique)], memory: memory.recent ?? {}, questions, recentEmojis: memory.emojis ?? {}, emojiPlacement });
    const finaliser = async (d, note) => {
      const final = {
        ...d,
        source: 'ia',
        model: result.model,
        usage: { input: result.usage.input_tokens, output: result.usage.output_tokens },
        angles,
      };
      await mkdir(CACHE, { recursive: true });
      await writeFile(cacheFile, JSON.stringify(final, null, 2));
      log(`   IA : dossier validé (essai ${attempt}${note}, ${result.usage.input_tokens} + ${result.usage.output_tokens} tokens)`);
      return final;
    };

    const dossier = typeset(result.dossier);
    const problems = controle(dossier);
    if (!problems.length) return finaliser(dossier, '');

    // Réparation des défauts mécaniques avant de renoncer à un dossier par ailleurs correct
    const { repare, faits } = reparer(dossier, problems);
    if (faits.length && !controle(repare).length) return finaliser(repare, `, réparé : ${faits.join(', ')}`);

    log(`   IA essai ${attempt} refusé : ${problems.join(' | ')}`);
    corrections = problems;
  }
  log('   IA : contrôles non satisfaits, règles de secours');
  return fallbackDossier(article);
}
