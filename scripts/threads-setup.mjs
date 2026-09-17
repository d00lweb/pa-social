// Mise en service de Threads : installe un jeton valable 60 jours et l'identifiant du compte.
// Aucune valeur n'est affichée.
//
// Usage : node --env-file=.env scripts/threads-setup.mjs [jeton]
//   Le jeton peut aussi être déposé dans .env sous THREADS_SHORT_TOKEN (rien ne transite alors
//   par la ligne de commande). THREADS_APP_SECRET n'est utile que si le jeton est à durée courte.

import { readFileSync, writeFileSync } from 'node:fs';

const fourni = (process.argv[2] ?? process.env.THREADS_SHORT_TOKEN ?? '').trim().replace(/#_$/, '').replace(/["']/g, '');
const secret = (process.env.THREADS_APP_SECRET ?? '').trim();

if (!fourni) {
  console.error('Usage : node --env-file=.env scripts/threads-setup.mjs <jeton>');
  console.error('Ou déposer le jeton dans .env sous THREADS_SHORT_TOKEN.');
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

console.log('1. Nature du jeton…');
let jeton = fourni;
let jours = null;

// Jeton court : on l'échange contre 60 jours (la clé secrète est alors indispensable)
const echange = secret
  ? await essayer('access_token', { grant_type: 'th_exchange_token', client_secret: secret, access_token: fourni }).catch(() => null)
  : null;

if (echange?.access_token) {
  jeton = echange.access_token;
  jours = Math.round((echange.expires_in ?? 0) / 86400);
  console.log(`   ✔ jeton court échangé, valable ${jours} jours`);
} else {
  // Le générateur du tableau de bord délivre déjà un jeton de 60 jours : l'échange le refuse
  // (« Session key invalid »). On le prolonge alors, ce qui confirme du même coup sa nature.
  const prolonge = await essayer('refresh_access_token', { grant_type: 'th_refresh_token', access_token: fourni }).catch(() => null);
  if (prolonge?.access_token) {
    jeton = prolonge.access_token;
    jours = Math.round((prolonge.expires_in ?? 0) / 86400);
    console.log(`   ✔ jeton déjà à durée longue, prolongé de ${jours} jours`);
  } else {
    console.log('   → ni échange ni prolongation possibles : le jeton sera utilisé tel quel s’il est valide');
  }
}

console.log('2. Lecture du compte Threads…');
const profil = await essayer('v1.0/me', { fields: 'id,username,name', access_token: jeton })
  .catch((e) => { console.error(`   ✘ jeton refusé : ${e.message}`); process.exit(1); });
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
poser('THREADS_TOKEN', jeton);
poser('THREADS_USER_ID', profil.id);
// le jeton de mise en service a fait son office : il ne doit pas rester dans la configuration
const restantes = lignes.filter((l) => !l.startsWith('THREADS_SHORT_TOKEN='));
writeFileSync('.env', restantes.join('\n'));
console.log(`   ✔ THREADS_TOKEN (${String(jeton).length} caractères) et THREADS_USER_ID enregistrés, jeton temporaire retiré`);

const echeance = jours ? new Date(Date.now() + jours * 86400e3).toLocaleDateString('fr-FR') : 'à vérifier';
console.log('\nIl reste à :');
console.log('  1. envoyer la configuration à GitHub, depuis Git Bash :  gh secret set SOCIAL < .env');
console.log('  2. vérifier sans rien publier :                          npm run smoke:threads');
console.log(`  3. renouveler avant le ${echeance} :                     npm run threads:refresh -- --ecrire`);
