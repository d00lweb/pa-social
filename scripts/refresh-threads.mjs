// Renouvellement du jeton Threads. Un jeton non rafraîchi pendant 60 jours expire
// définitivement : il faut alors tout refaire à la main. Ce script le prolonge de 60 jours.
// Usage : node --env-file=.env scripts/refresh-threads.mjs
const API = 'https://graph.threads.net';
const token = process.env.THREADS_TOKEN;

if (!token) {
  console.error('THREADS_TOKEN doit être renseigné dans .env');
  process.exit(1);
}

const res = await fetch(`${API}/refresh_access_token?${new URLSearchParams({ grant_type: 'th_refresh_token', access_token: token })}`);
const json = await res.json().catch(() => ({}));

if (!res.ok || json.error) {
  console.error(`Échec du renouvellement : ${json.error?.message ?? `HTTP ${res.status}`}`);
  console.error('Si le jeton a plus de 60 jours, il est perdu : il faut réautoriser l’app Threads.');
  process.exit(1);
}

const jours = Math.round((json.expires_in ?? 0) / 86400);
console.log(`Jeton renouvelé : valable ${jours} jours (jusqu'au ${new Date(Date.now() + (json.expires_in ?? 0) * 1000).toLocaleDateString('fr-FR')}).`);
console.log('Le nouveau jeton n’est pas affiché ici. Il doit remplacer THREADS_TOKEN dans .env et dans le secret SOCIAL :');
console.log('  node --env-file=.env scripts/refresh-threads.mjs --ecrire   puis   gh secret set SOCIAL < .env   (depuis Git Bash)');

// --ecrire : remplace la valeur dans .env sans jamais l'afficher
if (process.argv.includes('--ecrire') && json.access_token) {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const lignes = readFileSync('.env', 'utf8').split(/\r?\n/);
  let remplacee = false;
  const nouvelles = lignes.map((l) => {
    if (!l.startsWith('THREADS_TOKEN=')) return l;
    remplacee = true;
    return `THREADS_TOKEN=${json.access_token}`;
  });
  if (!remplacee) nouvelles.push(`THREADS_TOKEN=${json.access_token}`);
  writeFileSync('.env', nouvelles.join('\n'));
  console.log(`.env mis à jour (${json.access_token.length} caractères, valeur jamais affichée).`);
}
