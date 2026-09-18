import { loadJson, saveJson } from '../core/state.mjs';
import { classerLieu, identifiantsConfig } from '../brain/lieux.mjs';

// Récolte des lieux : relit les lieux tagués sur les publications de la page Facebook — ceux que
// le robot pose, et ceux qu'on ajoute à la main dans l'application — et les apprend pour toujours.
//
// Pourquoi Facebook : c'est le seul réseau qui rend le lieu d'une publication en lecture (Instagram
// n'expose pas ce champ), et ses identifiants de lieu sont ceux d'Instagram (vérifié le 18/09/2026).
// La recherche de lieux de Meta est fermée aux applications tierces depuis la v8.0, et celle de
// Threads renvoie des identifiants qu'Instagram refuse : relire nos propres publications est la
// seule source fiable.
//
// Un lieu n'entre dans la bibliothèque qu'après avoir été accepté par Instagram, sur un conteneur
// jamais publié. Au premier passage, tout l'historique de la page est relu ; ensuite les 100 dernières
// publications, une fois par heure au plus.

const FICHIER = 'lieux-appris.json';
const INTERVALLE = 3600e3;
const MAX_VERIFICATIONS = 40;
const V = () => process.env.GRAPH_VERSION || 'v23.0';

async function lieuxDesPublications({ tout }) {
  const places = [];
  const params = new URLSearchParams({ fields: 'place{id,name,location}', limit: '100', access_token: process.env.FB_TOKEN });
  let url = `https://graph.facebook.com/${V()}/${process.env.FB_PAGE_ID}/published_posts?${params}`;
  for (let page = 0; url && page < (tout ? 20 : 1); page++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
    const json = await res.json().catch(() => ({}));
    if (json.error) throw new Error(`Facebook : ${json.error.message}`);
    for (const p of json.data ?? []) if (p.place) places.push(p.place);
    url = json.paging?.next ?? null;
  }
  return places;
}

// Un refus portant sur le lieu est définitif. Meta l'exprime de deux façons : le message
// « location_id is not a valid location page ID », ou le sous-code 2207019 sous un message générique
// « Invalid parameter », avec un détail traduit (« l'ID de lieu n'est pas valide, ne s'affiche pas ou
// n'existe pas »). On s'appuie donc sur le sous-code, pas sur la langue du texte.
// Vu le 18/09/2026 : 3 lieux tagués sur de vrais posts Facebook sur 34 sont refusés ainsi par Instagram.
export const refusDeLieu = (error) => error?.error_subcode === 2207019 || /location/i.test(String(error?.message ?? ''));

// true : accepté · false : refusé pour de bon · exception : à retenter plus tard
async function accepteParInstagram(id, image) {
  const body = new URLSearchParams({ image_url: image, caption: 'verification de lieu', location_id: id, access_token: process.env.IG_TOKEN });
  const res = await fetch(`https://graph.facebook.com/${V()}/${process.env.IG_USER_ID}/media`, { method: 'POST', body, signal: AbortSignal.timeout(25000) });
  const json = await res.json().catch(() => ({}));
  if (!json.error) return true;
  // seul un refus portant sur le lieu est définitif ; une autre erreur (réseau, image, quota) se retente
  if (refusDeLieu(json.error)) return false;
  throw new Error(json.error.message ?? `HTTP ${res.status}`);
}

// image : une image publique déjà publiée par le robot, qui sert de support aux conteneurs de vérification
export async function recolterLieux({ now = Date.now(), image = null, log = console.log } = {}) {
  if (!process.env.FB_TOKEN || !process.env.FB_PAGE_ID || !process.env.IG_TOKEN || !process.env.IG_USER_ID) return [];
  const etat = { communes: {}, lieux: {}, refuses: [], amorce: false, derniere: null, ...(await loadJson(FICHIER, {})) };
  if (etat.derniere && now - Date.parse(etat.derniere) < INTERVALLE) return [];
  if (!image) {
    log('Récolte des lieux : aucune image publique pour vérifier, reportée');
    return [];
  }

  const connus = new Set([...identifiantsConfig(), ...Object.values(etat.communes), ...Object.values(etat.lieux), ...etat.refuses].map(String));
  const places = await lieuxDesPublications({ tout: !etat.amorce });
  const tentes = new Set();
  const appris = [];
  let verifies = 0;
  let complet = true;

  for (const place of places) {
    const lieu = classerLieu(place);
    if (!lieu || connus.has(lieu.id) || tentes.has(lieu.id)) continue;
    // même nom déjà appris sous un autre identifiant : le premier fait foi
    if (etat[lieu.section][lieu.nom]) continue;
    if (verifies >= MAX_VERIFICATIONS) {
      complet = false;
      break;
    }
    verifies++;
    tentes.add(lieu.id);
    let accepte;
    try {
      accepte = await accepteParInstagram(lieu.id, image);
    } catch (e) {
      log(`   Lieu « ${lieu.nom} » : vérification reportée (${e.message})`);
      complet = false;
      continue;
    }
    if (!accepte) {
      etat.refuses.push(lieu.id);
      log(`   Lieu « ${lieu.nom} » refusé par Instagram`);
      continue;
    }
    etat[lieu.section][lieu.nom] = lieu.id;
    appris.push(lieu);
    log(`   Lieu appris : ${lieu.nom} (${lieu.section === 'communes' ? 'commune' : 'lieu précis'})`);
  }

  // l'historique complet n'est tenu pour relu que si tout a pu être vérifié
  if (complet) etat.amorce = true;
  etat.derniere = new Date(now).toISOString();
  await saveJson(FICHIER, etat);
  return appris;
}
