// Mise en service de Threads : transforme le jeton court du tableau de bord en jeton de 60 jours,
// récupère l'identifiant du compte, et écrit les deux dans .env. Aucune valeur n'est affichée.
//
// Usage : node --env-file=.env scripts/threads-setup.mjs <jeton-court>
//   THREADS_APP_SECRET doit être présent dans .env (clé secrète de l'app Threads).

import { readFileSync, writeFileSync } from 'node:fs';

const court = process.argv[2] ?? process.env.THREADS_SHORT_TOKEN;
const secret = process.env.THREADS_APP_SECRET;

if (!court || !secret) {
  console.error('Usage : node --env-file=.env scripts/threads-setup.mjs <jeton-court>');
  console.error('Et THREADS_APP_SECRET renseigné dans .env (App Dashboard → Paramètres → Général).');
  process.exit(1);
}

// Meta migre threads.net vers threads.com : on tente les deux
const HOTES = ['https://graph.threads.net', 'https://graph.threads.com'];

async function essayer(chemin, params) {
  let derniere = 'aucune réponse';
  for (const hote of HOTES) {
    try {
      const res = await fetch(`${hote}/${chemin}?${new URLSearchParams(params)}`);
      const json = await res.json().catch(() => ({}));
      if (res.ok && !json.error) return json;
      derniere = json.error?.message ?? `HTTP ${res.status}`;
    } catch (e) {
      derniere = e.message;
    }
  }
  throw new Error(derniere);
}

console.log('1. Échange du jeton court contre un jeton longue durée…');
const longue = await essayer('access_token', { grant_type: 'th_exchange_token', client_secret: secret, access_token: court })
  .catch((e) => { console.error(`   ✘ ${e.message}`); process.exit(1); });

const jours = Math.round((longue.expires_in ?? 0) / 86400);
console.log(`   ✔ jeton obtenu (${String(longue.access_token).length} caractères, valable ${jours} jours)`);

console.log('2. Lecture du compte Threads…');
const profil = await essayer('v1.0/me', { fields: 'id,username,name', access_token: longue.access_token })
  .catch((e) => { console.error(`   ✘ ${e.message}`); process.exit(1); });
console.log(`   ✔ @${profil.username} · id ${profil.id}`);

console.log('3. Écriture dans .env…');
const lignes = readFileSync('.env', 'utf8').split(/\r?\n/);
const poser = (cle, valeur) => {
  let vue = false;
  for (let i = 0; i < lignes.length; i++) {
    if (lignes[i].startsWith(`${cle}=`)) { lignes[i] = `${cle}=${valeur}`; vue = true; }
  }
  if (!vue) lignes.push(`${cle}=${valeur}`);
};
poser('THREADS_TOKEN', longue.access_token);
poser('THREADS_USER_ID', profil.id);
writeFileSync('.env', lignes.join('\n'));
console.log('   ✔ THREADS_TOKEN et THREADS_USER_ID enregistrés (valeurs jamais affichées)');

console.log('\nIl reste à :');
console.log('  1. envoyer la configuration à GitHub, depuis Git Bash :  gh secret set SOCIAL < .env');
console.log('  2. vérifier sans rien publier :                          npm run smoke:threads');
console.log(`  3. renouveler le jeton avant le ${new Date(Date.now() + (longue.expires_in ?? 0) * 1000).toLocaleDateString('fr-FR')} : npm run threads:refresh -- --ecrire`);
