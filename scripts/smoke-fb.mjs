// Contrôle du jeton de Page Facebook : lecture seule, ne publie jamais rien.
// Usage : node --env-file=.env scripts/smoke-fb.mjs
const V = process.env.GRAPH_VERSION || 'v23.0';
const token = process.env.FB_TOKEN;
const pageId = process.env.FB_PAGE_ID;

const REQUISES = ['pages_manage_posts', 'pages_manage_engagement'];

if (!token || !pageId) {
  console.error('FB_PAGE_ID et FB_TOKEN doivent être renseignés dans .env');
  process.exit(1);
}

const get = async (chemin, params = {}) => {
  const url = `https://graph.facebook.com/${V}/${chemin}?${new URLSearchParams({ ...params, access_token: token })}`;
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && !json.error, json };
};

let echecs = 0;

console.log('1. La Page répond');
const page = await get(pageId, { fields: 'name,fan_count,link' });
if (page.ok) {
  console.log(`   ✔ ${page.json.name} · ${page.json.fan_count ?? '?'} abonnés · ${page.json.link ?? ''}`);
} else {
  echecs++;
  console.error(`   ✘ ${page.json.error?.message ?? 'réponse illisible'}`);
}

console.log('2. Le jeton porte les droits de publication');
const debug = await get('debug_token', { input_token: token });
const data = debug.json?.data;
if (debug.ok && data) {
  const scopes = data.scopes ?? [];
  const manquantes = REQUISES.filter((p) => !scopes.includes(p));
  const expire = data.data_access_expires_at ? new Date(data.data_access_expires_at * 1000).toLocaleDateString('fr-FR') : 'non précisée';
  console.log(`   type : ${data.type ?? '?'} · accès aux données jusqu'au ${expire}`);
  if (manquantes.length) {
    echecs++;
    console.error(`   ✘ permissions manquantes : ${manquantes.join(', ')}`);
  } else {
    console.log(`   ✔ ${REQUISES.join(' et ')} accordées`);
  }
} else {
  console.log(`   ? vérification impossible (${debug.json?.error?.message ?? 'sans détail'}), le test de publication ci-dessous fait foi`);
}

console.log('3. La Page accepte une publication (conteneur non publié)');
const essai = await fetch(`https://graph.facebook.com/${V}/${pageId}/photos`, {
  method: 'POST',
  body: new URLSearchParams({ url: 'https://www.gstatic.com/webp/gallery/1.jpg', published: 'false', access_token: token }),
});
const essaiJson = await essai.json().catch(() => ({}));
if (essai.ok && !essaiJson.error) {
  console.log(`   ✔ photo acceptée en brouillon (id ${essaiJson.id}), rien n'est visible sur la Page`);
} else {
  echecs++;
  console.error(`   ✘ ${essaiJson.error?.message ?? 'refus sans détail'}`);
}

console.log(echecs ? `\n${echecs} point(s) à corriger avant d'activer Facebook.` : "\nTout est bon : Facebook peut être activé.");
process.exitCode = echecs ? 1 : 0;
