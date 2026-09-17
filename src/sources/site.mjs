// Site officiel d'une entité → comptes affichés en pied de page.
// C'est la source la plus sûre : le pseudo vient de l'entité elle-même, jamais d'une supposition.
const UA = 'Mozilla/5.0 (compatible; pa-social/0.1; +https://passion-aquitaine.ouest-france.fr)';
const TIMEOUT = 8000;
const MAX_HTML = 600 * 1024;

// chemins qui ne sont pas des comptes
const IGNORE = new Set([
  'p', 'reel', 'reels', 'explore', 'accounts', 'share', 'intent', 'home', 'hashtag', 'i',
  'privacy', 'tos', 'legal', 'about', 'pages', 'sharer', 'profile.php', 'dialog', 'plugins',
  'story.php', 'groups', 'events', 'watch', 'login', 'search', 'help', 'settings',
]);

const propres = (liste) => [...new Set(liste)].filter((h) => !IGNORE.has(h.toLowerCase()));

export function extractHandles(html) {
  const tous = (re) => propres([...String(html).matchAll(re)].map((m) => m[1]));
  return {
    insta: tous(/instagram\.com\/([A-Za-z0-9._]{2,30})/g),
    x: tous(/(?:twitter|x)\.com\/([A-Za-z0-9_]{2,15})/g),
    facebook: tous(/facebook\.com\/([A-Za-z0-9._-]{2,40})/g),
  };
}

// Archives et encyclopédies : leurs pages affichent les comptes de l'institution qui les héberge,
// pas ceux de l'entité. Une fiche pointant vers Gallica nous faisait taguer la BnF.
const HEBERGEURS = /(?:^|\.)(?:gallica\.bnf\.fr|data\.bnf\.fr|archive\.org|wikipedia\.org|wikimedia\.org|persee\.fr|openstreetmap\.org)$/i;

// Comptes affichés sur un site ; listes vides si le site est injoignable ou n'appartient pas à l'entité
export async function handlesFromSite(url) {
  const vide = { insta: [], x: [], facebook: [] };
  if (!url) return vide;
  try {
    if (HEBERGEURS.test(new URL(url).hostname)) return vide;
  } catch {
    return vide;
  }
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) return vide;
    return extractHandles((await res.text()).slice(0, MAX_HTML));
  } catch (e) {
    console.error(`   Site « ${url} » : ${e.message}`);
    return vide;
  }
}
