import { readFileSync, writeFileSync, existsSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { fromRoot } from '../src/core/config.mjs';

// Fusionne l'état d'une exécution avec celui déjà enregistré sur GitHub.
// Deux exécutions peuvent se croiser : aucune ne doit effacer les publications de l'autre,
// sous peine de republier un article déjà en ligne (c'est ce qui a causé le doublon du 17/09).

export const cle = (e) => `${e.guid}|${e.channel}`;

// Logique pure : union des deux historiques, la publication la plus ancienne faisant foi,
// et la file débarrassée de ce qui figure déjà comme publié.
export function fusionner({ distant = [], local = [], file = [] }) {
  const parCle = new Map();
  for (const e of [...distant, ...local]) {
    const connue = parCle.get(cle(e));
    if (!connue || new Date(e.at) < new Date(connue.at)) parCle.set(cle(e), e);
  }
  const historique = [...parCle.values()].sort((a, b) => new Date(a.at) - new Date(b.at));
  return { historique, file: file.filter((item) => !parCle.has(cle(item))) };
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

// `localDir` : copie de l'état produit par l'exécution ; `state/` contient la version du dépôt
export function fusionnerDossiers(localDir) {
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
  for (const nom of ['memory.json', 'controls.json', 'telegram.json', 'mesures.json', 'pilotage.json', 'jetons.json', 'lieux-appris.json', 'abonnes.json']) {
    const valeur = lire(localDir, nom, null);
    if (valeur !== null) ecrire(nom, valeur);
  }
  // rapports mensuels : dossier entier, ils ne sont écrits qu'une fois par mois
  const rapports = join(localDir, 'rapports');
  if (existsSync(rapports)) cpSync(rapports, fromRoot('state', 'rapports'), { recursive: true });
  return { total: historique.length, ajoutees: historique.length - distant.length, file: file.length };
}

// Exécution en ligne de commande uniquement (les tests importent la logique pure)
if (process.argv[1]?.includes('fusion-etat')) {
  const localDir = process.argv[2];
  if (!localDir) {
    console.error('Usage : node scripts/fusion-etat.mjs <dossier-état-local>');
    process.exit(1);
  }
  const { total, ajoutees, file } = fusionnerDossiers(localDir);
  console.log(`État fusionné : ${total} publications (${ajoutees > 0 ? `+${ajoutees}` : 'aucune nouvelle'}), ${file} en file.`);
}
