// Contrôle du jeton Threads : lecture du profil et création d'un conteneur, jamais de publication.
// Usage : node --env-file=.env scripts/smoke-threads.mjs
const API = 'https://graph.threads.net/v1.0';
const token = process.env.THREADS_TOKEN;
const userId = process.env.THREADS_USER_ID;

if (!token || !userId) {
  console.error('THREADS_USER_ID et THREADS_TOKEN doivent être renseignés dans .env');
  process.exit(1);
}

const appel = async (chemin, params = {}, method = 'GET') => {
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = method === 'GET'
    ? await fetch(`${API}/${chemin}?${body}`)
    : await fetch(`${API}/${chemin}`, { method, body });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && !json.error, json };
};

let echecs = 0;

console.log('1. Le profil répond');
const profil = await appel('me', { fields: 'id,username,name,is_verified' });
if (profil.ok) {
  console.log(`   ✔ @${profil.json.username} · ${profil.json.name ?? ''} · id ${profil.json.id}`);
  if (String(profil.json.id) !== String(userId)) {
    echecs++;
    console.error(`   ✘ THREADS_USER_ID vaut ${userId}, le jeton appartient à ${profil.json.id}`);
  }
} else {
  echecs++;
  console.error(`   ✘ ${profil.json.error?.message ?? 'réponse illisible'}`);
}

console.log('2. Le compte accepte un brouillon (conteneur non publié)');
const conteneur = await appel(`${userId}/threads`, { media_type: 'TEXT', text: 'Contrôle technique Passion Aquitaine — non publié.' }, 'POST');
if (conteneur.ok && conteneur.json.id) {
  console.log(`   ✔ conteneur ${conteneur.json.id} créé, rien n'est publié (il expire seul sous 24 h)`);
} else {
  echecs++;
  console.error(`   ✘ ${conteneur.json.error?.message ?? 'refus sans détail'}`);
}

console.log(echecs ? `\n${echecs} point(s) à corriger avant d'activer Threads.` : "\nTout est bon : Threads peut être activé.");
process.exitCode = echecs ? 1 : 0;
