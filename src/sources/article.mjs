// Liens sortants d'un article de Passion Aquitaine : les sources que la rédaction cite.
//
// Ils ne servent qu'à une chose : retrouver le site officiel d'une entité que l'article nomme.
// Le 25/09/2026, l'article sur l'Ultra Trail de Pons renvoyait vers ultratraildepons.fr, et ce
// site déclare @ultratraildepons_officiel — la réponse que ni Wikidata ni Instagram ne donnaient.
//
// Jamais une source de mentions en soi : un article sur les levures du vin cite l'INRAE et
// l'université de Bordeaux, et les taguer à ce titre serait hors sujet.
const UA = 'Mozilla/5.0 (compatible; pa-social/0.1; +https://passion-aquitaine.ouest-france.fr)';
const TIMEOUT = 8000;

// le média lui-même, ses comptes, et les liens de partage : jamais des sources
const PROPRES = /(?:^|\.)(?:ouest-france\.fr|passion-aquitaine\.fr|lovaquitaine\.\w+)$/i;
const RESEAUX = /(?:^|\.)(?:facebook\.com|x\.com|twitter\.com|instagram\.com|linkedin\.com|whatsapp\.com|wa\.me|pinterest\.\w+|tiktok\.com|youtube\.com|youtu\.be|threads\.(?:net|com)|bsky\.app|t\.me|telegram\.me)$/i;
const TECHNIQUES = /(?:^|\.)(?:google\.\w+|googleapis\.com|gstatic\.com|doubleclick\.net|didomi\.io|apple\.com|schema\.org|w3\.org|wordpress\.org|gravatar\.com|cloudflare\.com|jsdelivr\.net)$/i;
const NOTRE_COMPTE = new Set(['lovaquitaine', 'passion.aquitaine', 'passionaquitaine']);

// Le corps de l'article seulement : l'en-tête et le pied de page portent les comptes du média.
export function extraireLiens(html) {
  const page = String(html ?? '');
  const debut = page.search(/<article[\s>]/i);
  const fin = page.lastIndexOf('</article>');
  const corps = debut >= 0 ? page.slice(debut, fin > debut ? fin : undefined) : page;
  const sites = [];
  const instagram = [];
  for (const [, url] of corps.matchAll(/href="(https?:\/\/[^"#]+)"/gi)) {
    let hote;
    try { hote = new URL(url).hostname.toLowerCase(); } catch { continue; }
    if (PROPRES.test(hote) || TECHNIQUES.test(hote)) continue;
    if (/(?:^|\.)instagram\.com$/.test(hote)) {
      const pseudo = /^\/([A-Za-z0-9._]{2,30})\/?$/.exec(new URL(url).pathname)?.[1]?.toLowerCase();
      if (pseudo && !NOTRE_COMPTE.has(pseudo)) instagram.push(pseudo);
      continue;
    }
    if (RESEAUX.test(hote)) continue;
    sites.push(url);
  }
  return { sites: [...new Set(sites)], instagram: [...new Set(instagram)] };
}

const memo = new Map();

export function liensArticle(url) {
  if (!url) return Promise.resolve({ sites: [], instagram: [] });
  if (!memo.has(url)) {
    memo.set(url, (async () => {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) });
        if (!res.ok) return { sites: [], instagram: [] };
        return extraireLiens(await res.text());
      } catch (e) {
        console.error(`   Article « ${url} » : ${e.message}`);
        return { sites: [], instagram: [] };
      }
    })());
  }
  return memo.get(url);
}
