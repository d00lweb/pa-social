// Contrôle complet des jetons, en lecture seule : rien n'est publié, aucune valeur de jeton affichée.
// Usage : npm run meta:check   (équivaut à node --env-file=.env scripts/meta-check.mjs)
//
// À lancer après avoir refait un jeton, avant de mettre à jour le secret GitHub.
const V = process.env.GRAPH_VERSION || 'v23.0';
const JOUR = 86400e3;

const DROITS = {
  FB_TOKEN: ['pages_manage_posts', 'pages_manage_engagement', 'pages_read_engagement'],
  IG_TOKEN: ['instagram_basic', 'instagram_content_publish'],
};

let echecs = 0;
const ok = (t) => console.log(`   ✔ ${t}`);
const ko = (t) => { echecs += 1; console.error(`   ✘ ${t}`); };
const info = (t) => console.log(`   · ${t}`);

async function graph(chemin, token, params = {}) {
  try {
    const url = `https://graph.facebook.com/${V}/${chemin}?${new URLSearchParams({ ...params, access_token: token })}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok && !json.error, json, erreur: json.error };
  } catch (e) {
    return { ok: false, json: {}, erreur: { message: e.message } };
  }
}

// Un jeton Meta : validité, nature, droits, échéance
async function jetonMeta(nom, token) {
  console.log(`\n${nom}`);
  if (!token) return ko(`absent du .env`);
  const debug = await graph('debug_token', token, { input_token: token });
  const d = debug.json?.data;
  if (!debug.ok || !d) {
    ko(`refusé par Meta : ${debug.erreur?.message ?? 'sans détail'}`);
    if (debug.erreur?.error_subcode === 460) info('sous-code 460 : la session du compte a été invalidée. Un jeton d’utilisateur système évite ce cas.');
    return null;
  }
  if (d.is_valid === false) return ko('jeton invalide');
  ok(`valide · type ${d.type ?? '?'}`);
  if (d.type === 'PAGE') info('jeton de Page : lié à la session du compte qui l’a créé');
  if (d.type === 'SYSTEM_USER' || d.type === 'SYSTEM_USER_APP') ok('utilisateur système : indépendant d’une session personnelle');
  const expire = d.expires_at ? new Date(d.expires_at * 1000) : null;
  const acces = d.data_access_expires_at ? new Date(d.data_access_expires_at * 1000) : null;
  info(`expiration du jeton : ${expire ? `${expire.toLocaleDateString('fr-FR')} (${Math.round((expire - Date.now()) / JOUR)} j)` : 'aucune'}`);
  if (acces) {
    const jours = Math.round((acces - Date.now()) / JOUR);
    (jours > 30 ? ok : ko)(`accès aux données jusqu’au ${acces.toLocaleDateString('fr-FR')} (${jours} j)`);
  }
  const scopes = d.scopes ?? [];
  const manquantes = (DROITS[nom] ?? []).filter((p) => !scopes.includes(p));
  if (manquantes.length) ko(`droits manquants : ${manquantes.join(', ')}`);
  else ok(`droits requis présents : ${(DROITS[nom] ?? []).join(', ')}`);
  return d;
}

console.log('Contrôle des jetons — lecture seule, rien n’est publié.');

await jetonMeta('FB_TOKEN', process.env.FB_TOKEN);
console.log('\nPage Facebook');
if (process.env.FB_PAGE_ID && process.env.FB_TOKEN) {
  const page = await graph(process.env.FB_PAGE_ID, process.env.FB_TOKEN, { fields: 'name,followers_count' });
  page.ok ? ok(`${page.json.name} · ${page.json.followers_count ?? '?'} abonnés`) : ko(page.erreur?.message ?? 'illisible');
} else ko('FB_PAGE_ID ou FB_TOKEN absent du .env');

await jetonMeta('IG_TOKEN', process.env.IG_TOKEN);
console.log('\nCompte Instagram');
if (process.env.IG_USER_ID && process.env.IG_TOKEN) {
  const ig = await graph(process.env.IG_USER_ID, process.env.IG_TOKEN, { fields: 'username,followers_count' });
  ig.ok ? ok(`@${ig.json.username} · ${ig.json.followers_count ?? '?'} abonnés`) : ko(ig.erreur?.message ?? 'illisible');
} else ko('IG_USER_ID ou IG_TOKEN absent du .env');

console.log('\nThreads');
if (process.env.THREADS_TOKEN) {
  const r = await fetch(`https://graph.threads.net/v1.0/me?fields=id,username&access_token=${process.env.THREADS_TOKEN}`, { signal: AbortSignal.timeout(20000) }).then((x) => x.json()).catch((e) => ({ error: { message: e.message } }));
  r.username ? ok(`@${r.username}`) : ko(r.error?.message ?? 'illisible');
} else ko('THREADS_TOKEN absent du .env');

console.log('\nBluesky');
const b = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(process.env.BLUESKY_HANDLE ?? '')}`, { signal: AbortSignal.timeout(20000) }).then((x) => x.json()).catch(() => ({}));
Number.isFinite(b.followersCount) ? ok(`@${b.handle} · ${b.followersCount} abonnés`) : ko('compte illisible');

console.log(echecs
  ? `\n${echecs} point(s) à corriger. Rien n’a été publié.`
  : '\nTout est bon. Prochaine étape : gh secret set SOCIAL < .env (depuis Git Bash), puis attendre le passage suivant.');
process.exitCode = echecs ? 1 : 0;
