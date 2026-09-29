import { readFileSync, writeFileSync, existsSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { fromRoot } from '../src/core/config.mjs';

// Fusionne l'état d'une exécution avec celui déjà enregistré sur GitHub.
// Deux exécutions peuvent se croiser : aucune ne doit effacer les publications de l'autre,
// sous peine de republier un article déjà en ligne (c'est ce qui a causé le doublon du 17/09).

export const cle = (e) => `${e.guid}|${e.channel}`;

// Logique pure : union des deux historiques, la publication la plus ancienne faisant foi,
// et la file débarrassée de ce qui figure déjà comme publié. Ce que l'autre version sait en plus
// (un lien retrouvé après coup, par exemple) complète la fiche sans jamais remplacer une valeur.
export function fusionner({ distant = [], local = [], file = [] }) {
  const parCle = new Map();
  for (const e of [...distant, ...local]) {
    const connue = parCle.get(cle(e));
    if (!connue) {
      parCle.set(cle(e), e);
      continue;
    }
    const [foi, autre] = new Date(e.at) < new Date(connue.at) ? [e, connue] : [connue, e];
    const fiche = { ...foi };
    for (const [k, v] of Object.entries(autre)) if (fiche[k] === undefined || fiche[k] === null) fiche[k] = v;
    parCle.set(cle(e), fiche);
  }
  const historique = [...parCle.values()].sort((a, b) => new Date(a.at) - new Date(b.at));
  return { historique, file: file.filter((item) => !parCle.has(cle(item))) };
}

// Relevé des coûts : ses compteurs ne font que croître, et il a deux écrivains — le robot et les
// essais lancés depuis un poste. Le 29/09/2026, un passage du robot parti juste avant l'envoi d'un
// essai a réenregistré sa propre version : 0,64 $ de dépense ont disparu du relevé, et avec eux
// du budget. On ajoute donc à la version du dépôt ce que l'exécution a dépensé depuis son départ
// (sa version moins celle qu'elle avait reprise). Un jour que l'exécution a purgé reste purgé.
// Sans état de départ (ancien enchaînement), la version de l'exécution fait foi, comme avant.
const arrondi = (x) => Math.round(x * 1e6) / 1e6;
export function fusionnerCouts({ distant = {}, local = {}, base = null }) {
  if (!base) return local;
  const ajouter = (d, l, b) => {
    if (typeof l === 'number') return arrondi((typeof d === 'number' ? d : 0) + l - (typeof b === 'number' ? b : 0));
    if (!l || typeof l !== 'object') return l ?? d;
    const out = d && typeof d === 'object' ? { ...d } : {};
    for (const [k, v] of Object.entries(l)) out[k] = ajouter(out[k], v, b?.[k]);
    return out;
  };
  const fusion = ajouter(distant, local, base);
  for (const jour of Object.keys(base)) if (!(jour in local)) delete fusion[jour];
  return fusion;
}

function lire(dir, nom, defaut) {
  const chemin = join(dir, nom);
  if (!existsSync(chemin)) return defaut;
  try {
    return JSON.parse(readFileSync(chemin, 'utf8'));
  } catch {
    return defaut;
  }
}

const ecrire = (nom, valeur) => writeFileSync(fromRoot('state', nom), `${JSON.stringify(valeur, null, 2)}\n`);

// `localDir` : copie de l'état produit par l'exécution ; `state/` contient la version du dépôt ;
// `baseDir` : l'état tel que l'exécution l'avait repris à son départ (sert au relevé des coûts)
export function fusionnerDossiers(localDir, baseDir = null) {
  const distant = lire(fromRoot('state'), 'published.json', []);
  const local = lire(localDir, 'published.json', []);
  const fileLocale = lire(localDir, 'queue.json', lire(fromRoot('state'), 'queue.json', []));

  const { historique, file } = fusionner({ distant, local, file: fileLocale });
  ecrire('published.json', historique);
  ecrire('queue.json', file);

  // mémoire, contrôles, compteur Telegram, mesures, instantané et lieux appris : la version de
  // l'exécution, la plus récente. Sans cette liste, une course entre deux passages les effacerait.
  // Les lieux appris ne font que croître et se retrouvent en relisant la page : un écrasement
  // occasionnel se rattrape tout seul au passage suivant.
  for (const nom of ['memory.json', 'controls.json', 'telegram.json', 'mesures.json', 'pilotage.json', 'jetons.json', 'lieux-appris.json', 'abonnes.json', 'mois-publics.json', 'ia.json', 'comptes-appris.json', 'moderation.json']) {
    const valeur = lire(localDir, nom, null);
    if (valeur !== null) ecrire(nom, valeur);
  }
  const couts = lire(localDir, 'couts.json', null);
  if (couts !== null) {
    const base = baseDir ? lire(baseDir, 'couts.json', null) : null;
    ecrire('couts.json', fusionnerCouts({ distant: lire(fromRoot('state'), 'couts.json', {}), local: couts, base }));
  }
  // rapports mensuels : dossier entier, ils ne sont écrits qu'une fois par mois
  const rapports = join(localDir, 'rapports');
  if (existsSync(rapports)) cpSync(rapports, fromRoot('state', 'rapports'), { recursive: true });
  return { total: historique.length, ajoutees: historique.length - distant.length, file: file.length };
}

// Exécution en ligne de commande uniquement (les tests importent la logique pure)
if (process.argv[1]?.includes('fusion-etat')) {
  const [localDir, baseDir] = process.argv.slice(2);
  if (!localDir) {
    console.error('Usage : node scripts/fusion-etat.mjs <dossier-état-local> [dossier-état-de-départ]');
    process.exit(1);
  }
  const { total, ajoutees, file } = fusionnerDossiers(localDir, baseDir);
  console.log(`État fusionné : ${total} publications (${ajoutees > 0 ? `+${ajoutees}` : 'aucune nouvelle'}), ${file} en file.`);
}
