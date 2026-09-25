// Applique `fn` à chaque élément, `n` à la fois, en gardant l'ordre des résultats.
// Assez pour ne pas attendre chaque appel l'un après l'autre, pas assez pour saturer une API.
export async function enParallele(liste, n, fn) {
  const sortie = new Array(liste.length);
  let suivant = 0;
  const ouvrier = async () => {
    while (suivant < liste.length) {
      const i = suivant++;
      sortie[i] = await fn(liste[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, liste.length)) }, ouvrier));
  return sortie;
}
