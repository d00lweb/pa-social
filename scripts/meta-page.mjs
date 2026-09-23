// Étape 7 du remplacement d'un jeton Meta : échange le jeton d'utilisateur système contre le
// jeton de la Page, et l'écrit dans .env (FB_TOKEN et IG_TOKEN). Aucun jeton n'est affiché.
//
//   npm run meta:page              puis coller le jeton d'utilisateur système et appuyer sur Entrée
//   npm run meta:page -- <jeton>   variante en une ligne
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

const V = process.env.GRAPH_VERSION || 'v23.0';
const ENV = '.env';

// Remplace des variables dans un .env sans toucher au reste (ordre, commentaires, fins de ligne)
export function remplacerVariables(texte, valeurs) {
  const finDeLigne = texte.includes('\r\n') ? '\r\n' : '\n';
  const restant = { ...valeurs };
  const sorties = texte.split(/\r?\n/).map((ligne) => {
    const m = ligne.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (!m || !(m[1] in restant)) return ligne;
    const valeur = restant[m[1]];
    delete restant[m[1]];
    return `${m[1]}=${valeur}`;
  });
  for (const [cle, valeur] of Object.entries(restant)) sorties.push(`${cle}=${valeur}`);
  return sorties.join(finDeLigne);
}

async function demanderJeton() {
  if (process.argv[2]) return process.argv[2].trim();
  // sans argument, on le demande : il ne reste pas dans l'historique du terminal
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question('Colle le jeton d’utilisateur système, puis Entrée :\n')).trim();
  } finally {
    rl.close();
  }
}

async function main() {
  const jeton = await demanderJeton();
  if (!jeton) {
    console.error('Aucun jeton fourni.');
    return 1;
  }
  if (jeton.length < 50) console.warn(`⚠ Ce jeton paraît court (${jeton.length} caractères) : vérifie qu'il a été copié en entier.`);

  const res = await fetch(`https://graph.facebook.com/${V}/me/accounts?${new URLSearchParams({ fields: 'name,access_token', access_token: jeton })}`);
  const json = await res.json().catch(() => ({}));
  if (json.error) {
    console.error(`✘ Meta refuse ce jeton : ${json.error.message}`);
    console.error('  → jeton incomplet, ou permission pages_show_list manquante.');
    return 1;
  }
  const pages = json.data ?? [];
  if (!pages.length) {
    console.error('✘ Aucune Page rattachée à ce jeton.');
    console.error('  → l’utilisateur système n’a pas reçu la Page en « contrôle total » (étape 4), ou pages_show_list n’est pas coché.');
    return 1;
  }
  console.log(`Pages trouvées : ${pages.map((p) => `${p.name} (${p.id})`).join(', ')}`);

  const attendue = process.env.FB_PAGE_ID;
  const page = attendue ? pages.find((p) => String(p.id) === String(attendue)) : pages[0];
  if (!page) {
    console.error(`✘ La Page ${attendue} n’est pas dans la liste : ce jeton ne donne pas accès à la bonne Page.`);
    return 1;
  }
  if (!page.access_token) {
    console.error('✘ Meta n’a pas renvoyé de jeton pour cette Page (permission manquante).');
    return 1;
  }
  if (!existsSync(ENV)) {
    console.error('✘ Fichier .env introuvable : lance la commande depuis la racine du projet.');
    return 1;
  }

  copyFileSync(ENV, `${ENV}.bak`);
  writeFileSync(ENV, remplacerVariables(readFileSync(ENV, 'utf8'), { FB_TOKEN: page.access_token, IG_TOKEN: page.access_token }));
  console.log(`✔ Jeton de la Page « ${page.name} » écrit dans .env (FB_TOKEN et IG_TOKEN). Ancienne version gardée dans .env.bak`);
  console.log('\nÀ suivre :\n  npm run meta:check             vérifier que tout répond\n  gh secret set SOCIAL < .env    publier le secret, depuis Git Bash');
  return 0;
}

if (process.argv[1]?.includes('meta-page')) process.exitCode = await main();
