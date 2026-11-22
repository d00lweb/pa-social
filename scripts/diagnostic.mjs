// Diagnostic des réseaux, en lecture seule : npm run diagnostic
// État réel des jetons (jamais leur valeur), publications de la Page Facebook par outil de publication,
// vues et clics relevés par Meta, visibilité sans connexion, Instagram, Threads, Telegram, Bluesky.
// Sert à répondre à « Facebook est-il visible ? » : une publication du robot doit avoir des vues et
// montrer son texte sans connexion, comme une publication faite à la main (constat du 22/11/2026).
const V = process.env.GRAPH_VERSION || 'v23.0';
const G = `https://graph.facebook.com/${V}`;
const e = process.env;
const propre = (s) => String(s ?? '').replace(/[A-Za-z0-9_\-|]{30,}/g, '<masqué>').slice(0, 220);
async function get(url, params = {}) {
  try {
    const res = await fetch(`${url}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(25000) });
    const json = await res.json().catch(() => ({}));
    if (json.error) return { erreur: `${json.error.code ?? ''}/${json.error.error_subcode ?? ''} ${propre(json.error.message)}` };
    return json;
  } catch (err) { return { erreur: propre(err.name + ' ' + (err.cause?.code ?? '')) }; }
}
const jour = (s) => (s ? new Date(s * 1000).toISOString().slice(0, 10) : s === 0 ? 'jamais (0)' : 'absent');

console.log('## JETONS META');
console.log('FB_TOKEN présent :', Boolean(e.FB_TOKEN), '| IG_TOKEN présent :', Boolean(e.IG_TOKEN), '| identiques :', e.FB_TOKEN === e.IG_TOKEN);
let appId = null;
for (const nom of ['FB_TOKEN', 'IG_TOKEN']) {
  if (!e[nom]) continue;
  const d = await get(`${G}/debug_token`, { input_token: e[nom], access_token: e[nom] });
  if (d.erreur) { console.log(nom, 'ERREUR', d.erreur); continue; }
  const x = d.data ?? {};
  appId ??= x.app_id;
  console.log(nom, '| type', x.type, '| app', x.application, '| valide', x.is_valid, '| expire', jour(x.expires_at), '| accès aux données jusqu’au', jour(x.data_access_expires_at), '| émis', jour(x.issued_at));
  console.log('   droits :', (x.scopes ?? []).join(', '));
}

console.log('\n## APPLICATION META (mode)');
if (appId) {
  for (const f of ['name', 'category', 'link', 'app_type', 'restrictions', 'supported_platforms', 'company', 'created_time']) {
    const a = await get(`${G}/${appId}`, { fields: f, access_token: e.FB_TOKEN });
    console.log('  ', f, ':', a.erreur ? 'ERREUR ' + a.erreur : JSON.stringify(a[f] ?? null).slice(0, 160));
  }
}

console.log('\n## PAGE');
for (const f of ['name', 'fan_count', 'followers_count', 'is_published', 'verification_status', 'has_transitioned_to_new_page_experience', 'talking_about_count', 'new_like_count', 'category', 'can_post', 'is_unclaimed', 'age_restrictions', 'country_page_likes', 'restrictions', 'is_eligible_for_branded_content', 'page_token']) {
  if (f === 'page_token') continue;
  const p = await get(`${G}/${e.FB_PAGE_ID}`, { fields: f, access_token: e.FB_TOKEN });
  console.log('  ', f, ':', p.erreur ? 'ERREUR ' + p.erreur : JSON.stringify(p[f] ?? null).slice(0, 160));
}

console.log('\n## PUBLICATIONS DE LA PAGE (les plus récentes d’abord)');
const jeux = [
  ["published_posts", "id,created_time,status_type,is_published,is_hidden,message,permalink_url,application,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),attachments{type,media_type},privacy,timeline_visibility"],
  ["published_posts", "id,created_time,status_type,is_published,is_hidden,message,permalink_url,application,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)"],
  ["feed", "id,created_time,status_type,is_published,is_hidden,message,permalink_url,application,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)"],
  ["feed", "id,created_time,message,permalink_url,application,shares"],
  ["posts", "id,created_time,message,permalink_url"],
];
const posts = [];
for (const [arete, champs] of jeux) {
  let url = G + "/" + e.FB_PAGE_ID + "/" + arete, params = { fields: champs, limit: "50", access_token: e.FB_TOKEN };
  let echec = null;
  for (let page = 0; page < 6 && url; page++) {
    const r = await get(url, params);
    if (r.erreur) { echec = r.erreur; break; }
    posts.push(...(r.data ?? []));
    const suite = r.paging?.next;
    if (!suite) break;
    const u = new URL(suite); url = u.origin + u.pathname; params = Object.fromEntries(u.searchParams);
  }
  console.log("essai", arete, "(" + champs.split(",").length + " champs) :", echec ? "ERREUR " + echec.slice(0, 90) : "ok");
  if (posts.length) break;
}
console.log('lues :', posts.length, '| de', posts.at(-1)?.created_time?.slice(0, 10), 'à', posts[0]?.created_time?.slice(0, 10));
const ligne = (p) => [p.created_time?.slice(0, 16), (p.status_type ?? '-').padEnd(22), ('app:' + (p.application?.name ?? 'aucune')).padEnd(32), 'réactions', p.reactions?.summary?.total_count ?? '?', 'comm', p.comments?.summary?.total_count ?? '?', 'part', p.shares?.count ?? 0, '| publié', p.is_published, 'masqué', p.is_hidden, 'vis', p.timeline_visibility ?? '-', 'conf', p.privacy?.value ?? '-', '|', p.attachments?.data?.[0]?.type ?? '-', '|', (p.message ?? '').replace(/\s+/g, ' ').slice(0, 50)].join(' ');
const parApp = {};
for (const p of posts) { const k = p.application?.name ?? 'aucune (publication à la main)'; (parApp[k] ??= []).push(p); }
for (const [k, l] of Object.entries(parApp)) {
  const r = l.map((p) => p.reactions?.summary?.total_count ?? 0), c = l.map((p) => p.comments?.summary?.total_count ?? 0), s = l.map((p) => p.shares?.count ?? 0);
  const som = (a) => a.reduce((x, y) => x + y, 0);
  console.log(`\n# Outil « ${k} » : ${l.length} publications, du ${l.at(-1).created_time.slice(0, 10)} au ${l[0].created_time.slice(0, 10)} | réactions total ${som(r)} (moy ${(som(r) / l.length).toFixed(1)}), commentaires ${som(c)}, partages ${som(s)} | à zéro : ${l.filter((p, i) => r[i] + c[i] + s[i] === 0).length}`);
  for (const p of l.slice(0, 6)) console.log('  ', ligne(p));
  if (l.length > 6) console.log('   …');
  for (const p of l.slice(-3)) if (l.length > 9) console.log('  ', ligne(p));
}
// par mois, toutes origines
const mois = {};
for (const p of posts) { const k = p.created_time.slice(0, 7) + ' ' + (p.application?.name ? 'outil' : 'main'); (mois[k] ??= []).push((p.reactions?.summary?.total_count ?? 0) + (p.comments?.summary?.total_count ?? 0) + (p.shares?.count ?? 0)); }
console.log('\n# Interactions par mois et origine :', Object.keys(mois).sort().map((k) => `${k} n=${mois[k].length} moy=${(mois[k].reduce((x, y) => x + y, 0) / mois[k].length).toFixed(1)}`).join(' | '));

console.log('\n## STATISTIQUES (droit read_insights)');
for (const m of ["page_media_view", "page_total_media_view_unique", "page_post_engagements", "page_views_total", "page_daily_follows_unique", "page_daily_unfollows_unique", "page_impressions_unique", "page_impressions"]) {
  const ins = await get(G + "/" + e.FB_PAGE_ID + "/insights", { metric: m, period: "day", since: String(Math.floor(Date.now() / 1000) - 29 * 86400), until: String(Math.floor(Date.now() / 1000)), access_token: e.FB_TOKEN });
  const v = ins.data?.[0]?.values?.map((x) => x.value) ?? [];
  console.log("page", m, ":", ins.erreur ? "ERREUR " + ins.erreur.slice(0, 80) : (v.length ? "28 j total " + v.reduce((a, b) => a + (Number(b) || 0), 0) + " | 7 derniers jours " + JSON.stringify(v.slice(-7)) : "vide"));
}
const robot = posts.find((p) => p.application?.name), main = posts.find((p) => !p.application?.name);
for (const [nom, p] of [['publication de l’outil', robot], ['publication à la main', main]]) {
  if (!p) continue;
  for (const m of ["post_media_view", "post_total_media_view_unique", "post_impressions_unique", "post_clicks", "post_reactions_by_type_total", "post_impressions_organic_unique"]) {
    const pi = await get(G + "/" + p.id + "/insights", { metric: m, access_token: e.FB_TOKEN });
    console.log(nom, p.created_time.slice(0, 10), m, ":", pi.erreur ? "ERREUR " + pi.erreur.slice(0, 70) : JSON.stringify(pi.data?.[0]?.values?.[0]?.value ?? "vide"));
  }
}

console.log('\n## VISIBILITÉ PUBLIQUE (lecture sans connexion, comme un robot d’aperçu)');
async function voir(p, nom) {
  if (!p?.permalink_url) return;
  for (const ua of ['facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36']) {
    try {
      const res = await fetch(p.permalink_url, { headers: { 'user-agent': ua, 'accept-language': 'fr-FR,fr;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
      const html = await res.text();
      const debut = (p.message ?? '').replace(/\s+/g, ' ').slice(0, 25);
      const og = (html.match(/property="og:(?:title|description)" content="([^"]{0,120})/g) ?? []).map((s) => s.replace(/.*content="/, '')).join(' || ');
      console.log(nom, p.created_time.slice(0, 10), '| UA', ua.slice(0, 12), '| HTTP', res.status, '| redirigé vers login :', /login/.test(res.url), '| taille', html.length, '| texte du post présent :', debut ? html.includes(debut.slice(0, 18)) : 'n/a', '| indisponible :', /isn&#039;t available|n&#039;est pas disponible|content isn't available|Ce contenu n'est pas disponible/i.test(html), '| og :', og.slice(0, 160));
    } catch (err) { console.log(nom, 'ERREUR', propre(err.name)); }
  }
}
const robots = posts.filter((p) => p.application?.name), mains = posts.filter((p) => !p.application?.name);
await voir(robots[2], 'OUTIL  ');
await voir(robots[30], 'OUTIL  ');
await voir(mains[0], 'MAIN   ');
await voir(mains[1], 'MAIN   ');

console.log('\n## INSTAGRAM');
const ig = await get(`${G}/${e.IG_USER_ID}`, { fields: 'username,followers_count,media_count', access_token: e.IG_TOKEN });
console.log(ig.erreur ? 'ERREUR ' + ig.erreur : `@${ig.username} | abonnés ${ig.followers_count} | publications ${ig.media_count}`);
const med = await get(`${G}/${e.IG_USER_ID}/media`, { fields: 'id,timestamp,media_type,like_count,comments_count', limit: '3', access_token: e.IG_TOKEN });
if (med.data?.[0]) {
  const mi = await get(`${G}/${med.data[0].id}/insights`, { metric: 'reach,saved,shares,views', access_token: e.IG_TOKEN });
  console.log('portée du dernier post :', mi.erreur ? 'ERREUR ' + mi.erreur : JSON.stringify(mi.data?.map((m) => [m.name, m.values?.[0]?.value])));
}

console.log('\n## THREADS');
if (e.THREADS_TOKEN) {
  const t = await get('https://graph.threads.net/v1.0/debug_token', { input_token: e.THREADS_TOKEN, access_token: e.THREADS_TOKEN });
  if (t.erreur) console.log('debug_token : ERREUR', t.erreur);
  else console.log('debug_token | type', t.data?.type, '| valide', t.data?.is_valid, '| expire', jour(t.data?.expires_at), '| émis', jour(t.data?.issued_at), '| droits', (t.data?.scopes ?? []).join(', '));
  const me = await get('https://graph.threads.net/v1.0/me', { fields: 'id,username', access_token: e.THREADS_TOKEN });
  console.log('profil :', me.erreur ? 'ERREUR ' + me.erreur : '@' + me.username);
}

console.log('\n## TELEGRAM, BLUESKY');
if (e.TELEGRAM_BOT_TOKEN) {
  try { const r = await (await fetch(`https://api.telegram.org/bot${e.TELEGRAM_BOT_TOKEN}/getMe`, { signal: AbortSignal.timeout(15000) })).json(); console.log('Telegram :', r.ok ? 'ok @' + r.result.username : 'refusé'); } catch { console.log('Telegram : injoignable'); }
}
if (e.BLUESKY_HANDLE) {
  const b = await get('https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile', { actor: e.BLUESKY_HANDLE });
  console.log('Bluesky (profil public) :', b.erreur ? 'ERREUR ' + b.erreur : `@${b.handle} | abonnés ${b.followersCount} | posts ${b.postsCount}`);
}
