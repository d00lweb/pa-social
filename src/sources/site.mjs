// Site officiel d'une entité → comptes affichés en pied de page.
// C'est la source la plus sûre : le pseudo vient de l'entité elle-même, jamais d'une supposition.
const UA = 'Mozilla/5.0 (compatible; pa-social/0.1; +https://passion-aquitaine.ouest-france.fr)';
const TIMEOUT = 8000;
const MAX_HTML = 600 * 1024;

// chemins qui ne sont pas des comptes
const IGNORE = new Set([
  'p', 'reel', 'reels', 'explore', 'accounts', 'share', 'intent', 'home', 'hashtag', 'i',
  'privacy', 'tos', 'legal', 'about', 'pages', 'sharer', 'profile.php', 'dialog', 'plugins',
  'story.php', 'groups', 'events', 'watch', 'login', 'search', 'help', 'settings', 'embed',
  'stories', 'tv', 'direct', 'web', 'developer', 'developers', 'oauth', 'signup', 'hashtags',
]);

const propres = (liste) => [...new Set(liste)].filter((h) => h && !IGNORE.has(h.toLowerCase()));

// Le nom du réseau doit commencer l'adresse : sans cette frontière, « festivalbordeaux.com/xmlrpc »
// se lisait « x.com/xmlrpc », et le site du FAB déclarait onze comptes X imaginaires.
const LIEN = (hote) => new RegExp(`(?<![A-Za-z0-9.-])(?:www\\.|mobile\\.|m\\.)?${hote}`, 'g');

export function extractHandles(html) {
  const texte = String(html);
  const tous = (hote, motif, casse = (h) => h) => propres([...texte.matchAll(new RegExp(LIEN(hote).source + motif, 'g'))].map((m) => casse(m[1])));
  return {
    // un pseudo Instagram ne distingue pas la casse, et ne finit jamais par un point
    insta: tous('instagram\\.com\\/', '([A-Za-z0-9._]{2,30})', (h) => h.toLowerCase().replace(/\.+$/, '')),
    x: tous('(?:twitter|x)\\.com\\/(?:#!\\/)?', '([A-Za-z0-9_]{2,15})(?![A-Za-z0-9_])'),
    facebook: tous('facebook\\.com\\/', '([A-Za-z0-9._-]{2,40})'),
    // Bluesky et Threads : un lien de profil sur le site officiel vaut déclaration, comme Instagram
    bluesky: tous('bsky\\.app\\/profile\\/', '([A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+)', (h) => h.toLowerCase()),
    threads: tous('threads\\.(?:net|com)\\/@', '([A-Za-z0-9._]{2,30})', (h) => h.toLowerCase().replace(/\.+$/, '')),
  };
}

// Archives et encyclopédies : leurs pages affichent les comptes de l'institution qui les héberge,
// pas ceux de l'entité. Une fiche pointant vers Gallica nous faisait taguer la BnF.
const HEBERGEURS = /(?:^|\.)(?:gallica\.bnf\.fr|data\.bnf\.fr|archive\.org|wikipedia\.org|wikimedia\.org|persee\.fr|openstreetmap\.org)$/i;

// Adresses qui n'appartiennent pas au compte qui les affiche : un lien Linktree ou une vidéo
// YouTube en biographie ne dit rien de l'identité de son auteur.
const PLATEFORMES = /(?:^|\.)(?:linktr\.ee|bit\.ly|zaap\.bio|beacons\.ai|linkin\.bio|lnk\.bio|campsite\.bio|taplink\.cc|solo\.to|youtu\.be|youtube\.com|google\.com|goo\.gl|facebook\.com|instagram\.com|x\.com|twitter\.com|tiktok\.com|linkedin\.com|wa\.me|calendly\.com|helloasso\.com|eventbrite\.\w+|billetweb\.fr|weezevent\.com|bloowatch\.com|canva\.site|wixsite\.com|my\.canva\.site)$/i;

// Domaine d'une adresse, sans « www » : « http://www.bergerac.fr/ » → « bergerac.fr ».
// null pour une plateforme tierce, qui ne prouve rien.
export function domaine(url) {
  try {
    const hote = new URL(/^https?:\/\//i.test(String(url)) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\d?\./, '');
    return hote && !PLATEFORMES.test(hote) && !HEBERGEURS.test(hote) ? hote : null;
  } catch {
    return null;
  }
}

// Le nom porté par un domaine, extension retirée : « huitres-arcachon-capferret.fr » →
// « huitres-arcachon-capferret », « fab.festivalbordeaux.com » → « fab.festivalbordeaux ».
export function libelle(url) {
  const d = domaine(url);
  if (!d) return null;
  const parties = d.split('.');
  // extensions à deux niveaux (« co.uk », « gouv.fr ») : on retire les deux
  const double = parties.length > 2 && /^(?:co|com|org|gouv|asso|net)$/.test(parties.at(-2));
  return parties.slice(0, double ? -2 : -1).join('.') || null;
}

const memo = new Map();

// Comptes affichés sur un site ; listes vides si le site est injoignable ou n'appartient pas à l'entité
export function handlesFromSite(url) {
  const vide = { insta: [], x: [], facebook: [], bluesky: [], threads: [] };
  if (!url) return Promise.resolve(vide);
  try {
    if (HEBERGEURS.test(new URL(url).hostname)) return Promise.resolve(vide);
  } catch {
    return Promise.resolve(vide);
  }
  // un même site revient d'un réseau à l'autre, et d'une entité à l'autre : lu une seule fois
  if (!memo.has(url)) {
    memo.set(url, (async () => {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) });
        if (!res.ok) return vide;
        return extractHandles((await res.text()).slice(0, MAX_HTML));
      } catch (e) {
        console.error(`   Site « ${url} » : ${e.message}`);
        return vide;
      }
    })());
  }
  return memo.get(url);
}
