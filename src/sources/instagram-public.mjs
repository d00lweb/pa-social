// Comptes Instagram d'autrui, lus par l'API Graph : ce que chacun déclare publiquement.
// Deux lectures, et elles ne prouvent pas la même chose :
//  · la description (business_discovery) donne nom, biographie, abonnés et site web — mais seulement
//    pour un compte professionnel ou créateur ; un compte personnel reste muet ;
//  · l'essai d'identification (un conteneur de carrousel portant le tag) prouve qu'un pseudo existe,
//    même personnel, sans rien dire de qui le tient.

const version = () => process.env.GRAPH_VERSION || 'v23.0';
const PSEUDO = /^[a-z0-9._]{1,30}$/;

// Une panne n'est pas une absence. Sans cette distinction, un quota dépassé ou un réseau coupé
// laissait croire qu'une ville n'avait aucun compte, et ce « rien » était mémorisé pour 90 jours.
export class LectureIncertaine extends Error {}

// 110 / 2207013 : pseudo inconnu, ou compte personnel que l'API ne décrit pas. Tout le reste —
// quota, jeton, panne de Meta — est incertain et ne doit rien conclure.
const absent = (erreur) => erreur?.code === 110 || erreur?.error_subcode === 2207013;

const descriptions = new Map();

export function decrireInstagram(handle) {
  const cle = String(handle ?? '').trim().replace(/^@/, '').toLowerCase();
  if (!PSEUDO.test(cle)) return Promise.resolve(null);
  if (!descriptions.has(cle)) {
    const lecture = (async () => {
      const token = process.env.IG_TOKEN;
      const userId = process.env.IG_USER_ID;
      if (!token || !userId) throw new LectureIncertaine('IG_TOKEN ou IG_USER_ID absent');
      const champs = `business_discovery.username(${cle}){username,name,biography,followers_count,website}`;
      let json;
      try {
        const res = await fetch(`https://graph.facebook.com/${version()}/${userId}?fields=${encodeURIComponent(champs)}&access_token=${token}`, { signal: AbortSignal.timeout(15000) });
        json = await res.json();
      } catch (e) {
        throw new LectureIncertaine(e.message);
      }
      const b = json?.business_discovery;
      if (b) {
        return {
          handle: String(b.username ?? cle).toLowerCase(),
          nom: b.name ?? '',
          description: String(b.biography ?? '').replace(/\s+/g, ' ').trim(),
          abonnes: Number.isFinite(b.followers_count) ? b.followers_count : null,
          site: b.website ?? null,
        };
      }
      if (absent(json?.error)) return null;
      throw new LectureIncertaine(json?.error?.message ?? 'réponse vide');
    })();
    // une lecture incertaine n'est pas gardée : la suivante retentera
    lecture.catch(() => descriptions.delete(cle));
    descriptions.set(cle, lecture);
  }
  return descriptions.get(cle);
}

const existences = new Map();

// Meta refuse un pseudo inexistant ou privé : c'est la preuve d'existence d'un compte personnel.
// Coûteux (un conteneur créé par essai) : réservé aux pseudos bâtis sur le nom exact d'une entité.
export function existeSurInstagram(handle, image) {
  const cle = String(handle ?? '').trim().replace(/^@/, '').toLowerCase();
  if (!PSEUDO.test(cle) || !image) return Promise.resolve(false);
  if (!existences.has(cle)) {
    existences.set(cle, (async () => {
      const token = process.env.IG_TOKEN;
      const userId = process.env.IG_USER_ID;
      if (!token || !userId) return false;
      try {
        const res = await fetch(`https://graph.facebook.com/${version()}/${userId}/media`, {
          method: 'POST',
          body: new URLSearchParams({
            image_url: image,
            is_carousel_item: 'true',
            user_tags: JSON.stringify([{ username: cle, x: 0.5, y: 0.9 }]),
            access_token: token,
          }),
          // sans délai, un appel qui ne répond pas fige toute l'exécution
          signal: AbortSignal.timeout(15000),
        });
        return res.ok;
      } catch {
        return false;
      }
    })());
  }
  return existences.get(cle);
}
