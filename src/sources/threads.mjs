// Présence sur Threads : une mention n'a de valeur que si le compte y a ouvert un profil,
// sinon @quelquechose n'est que du texte mort, sans lien ni notification.
// Un vrai profil renvoie « Nom (@compte) • Threads » ; un compte absent renvoie la page de connexion.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const TIMEOUT = 8000;

const cache = new Map();

export const titreIndiqueAbsence = (titre) => /Threads\s*•\s*Log in/i.test(String(titre ?? ''));

// true : présent · false : absent · null : impossible de savoir (réseau, page inattendue).
// Le doute n'est jamais mémorisé comme une absence : il se retente au passage suivant.
export async function surThreads(handle) {
  const cle = String(handle ?? '').toLowerCase();
  if (!cle) return false;
  if (cache.has(cle)) return cache.get(cle);

  try {
    const res = await fetch(`https://www.threads.com/@${cle}`, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) return null;
    const titre = /<title>([^<]{0,120})/.exec(await res.text())?.[1] ?? '';
    if (!titre) return null;
    const present = !titreIndiqueAbsence(titre);
    cache.set(cle, present);
    return present;
  } catch (e) {
    console.error(`   Threads « ${handle} » : ${e.message}`);
    return null;
  }
}
