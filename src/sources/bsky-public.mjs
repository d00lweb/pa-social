// API publique Bluesky : recherche de comptes et lecture de profil, gratuites et sans jeton.
// Sert à trouver un compte existant, jamais à en deviner un.
const API = 'https://public.api.bsky.app/xrpc';
const TIMEOUT = 8000;

// Un compte dont Bluesky n'a pas pu vérifier le pseudo s'affiche « handle.invalid » : rien à
// mentionner. Vu le 06/10/2026 sur le jumeau Bluesky supposé de Purple Disco Machine (77 abonnés).
const valide = (handle) => Boolean(handle) && handle !== 'handle.invalid';

async function appel(methode, params) {
  const url = `${API}/${methode}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) return null;
  return res.json();
}

// Comptes correspondant à une recherche, avec de quoi juger : nom, description, abonnés
export async function chercheActeurs(requete, limit = 10) {
  try {
    const json = await appel('app.bsky.actor.searchActors', { q: requete, limit: String(limit) });
    return (json?.actors ?? []).filter((a) => valide(a.handle)).map((a) => ({
      handle: a.handle,
      nom: a.displayName ?? '',
      description: (a.description ?? '').replace(/\s+/g, ' '),
    }));
  } catch (e) {
    console.error(`   Bluesky (recherche « ${requete} ») : ${e.message}`);
    return [];
  }
}

// Profil complet : le nombre d'abonnés départage un compte officiel d'un squatteur
export async function profil(acteur) {
  try {
    const json = await appel('app.bsky.actor.getProfile', { actor: acteur });
    if (!valide(json?.handle)) return null;
    return {
      handle: json.handle,
      nom: json.displayName ?? '',
      description: (json.description ?? '').replace(/\s+/g, ' '),
      abonnes: json.followersCount ?? 0,
      posts: json.postsCount ?? 0,
    };
  } catch {
    return null;
  }
}

// Profil, en distinguant l'absence de la panne : « Profile not found » (400) renvoie null, et se
// mémorise ; un réseau coupé ou une erreur du serveur lève une exception, et ne conclut rien.
export async function lireProfil(acteur) {
  const res = await fetch(`${API}/app.bsky.actor.getProfile?${new URLSearchParams({ actor: acteur })}`, { signal: AbortSignal.timeout(TIMEOUT) });
  if (res.status === 400 || res.status === 404) return null;
  if (!res.ok) throw new Error(`Bluesky HTTP ${res.status}`);
  const json = await res.json();
  if (!valide(json?.handle)) return null;
  return {
    handle: json.handle,
    nom: json.displayName ?? '',
    description: (json.description ?? '').replace(/\s+/g, ' '),
    abonnes: json.followersCount ?? 0,
  };
}

// Identifiant technique exigé par une mention ; null si le compte n'existe pas
export async function resoudreHandle(handle) {
  try {
    const json = await appel('com.atproto.identity.resolveHandle', { handle });
    return json?.did ?? null;
  } catch {
    return null;
  }
}
