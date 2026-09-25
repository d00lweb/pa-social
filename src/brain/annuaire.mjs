// Choix des comptes à mentionner. Règle de fond : l'IA propose des NOMS d'entités,
// jamais des pseudos ; le pseudo vient de la fiche officielle ou du site de l'entité,
// et rien n'est publié sans vérification. Aucun compte trouvé est un résultat normal.

export const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

const PETITS = new Set(['de', 'du', 'des', 'le', 'la', 'les', 'd', 'l', 'en', 'et', 'aux', 'au', 'un', 'une', 'pour']);
export const motsCles = (nom) => fold(nom).split(/[^a-z0-9]+/).filter((m) => m.length > 2 && !PETITS.has(m));

const jetons = (s) => new Set(fold(s).split(/[^a-z0-9]+/).filter(Boolean));

// Mots qu'un compte officiel peut ajouter au nom de l'entité sans changer de sujet
export const CIVIQUES = new Set([
  'ville', 'mairie', 'commune', 'departement', 'departemental', 'conseil', 'officiel', 'officielle',
  'compte', 'agglomeration', 'metropole', 'communaute', 'agglo',
]);

// Un candidat n'est retenu que si TOUS les mots du nom figurent dans son nom ou son pseudo,
// comparés comme des MOTS ENTIERS : « ami » ne doit pas se reconnaître dans « gaming ».
// Et il ne doit pas parler d'autre chose : « Université de Bordeaux » n'est pas « Bordeaux ».
export function correspond(entite, candidat) {
  const mots = motsCles(entite);
  if (!mots.length) return false;
  const cible = jetons(`${candidat.nom ?? ''} ${candidat.handle ?? ''}`);
  if (!mots.every((m) => cible.has(m))) return false;
  const attendus = new Set([...mots, ...CIVIQUES]);
  return motsCles(candidat.nom ?? '').every((m) => attendus.has(m));
}

// Part d'une chaîne écrite avec les mots d'un nom. « ultratraildepons » s'écrit entièrement avec
// « Ultra Trail de Pons » ; « transportsnouvelleaquitaine » ne s'écrit qu'aux deux tiers avec
// « TER Nouvelle-Aquitaine ». C'est ce qui dit qu'une adresse ou un pseudo porte bien un nom.
export function couverture(chaine, nom) {
  const s = fold(chaine).replace(/[^a-z0-9]+/g, '');
  const mots = [...new Set(fold(nom).split(/[^a-z0-9]+/).filter((m) => m.length >= 2))];
  if (!s || !mots.length) return 0;
  const meilleur = new Array(s.length + 1).fill(0);
  for (let i = 0; i < s.length; i++) {
    meilleur[i + 1] = Math.max(meilleur[i + 1], meilleur[i]);
    for (const m of mots) {
      if (s.startsWith(m, i)) meilleur[i + m.length] = Math.max(meilleur[i + m.length], meilleur[i] + m.length);
    }
  }
  return meilleur[s.length] / s.length;
}

// Tous les mots du nom figurent dans celui du candidat, qui peut en porter d'autres. Trop faible en
// général (« Université de Bordeaux » contient « Bordeaux »), suffisant pour une commune composée
// quand le contexte départage : « Hossegor » est la commune de Soorts-Hossegor.
export function contient(nom, candidat) {
  const mots = motsCles(nom);
  const cible = jetons(`${candidat.nom ?? ''}`);
  return mots.length > 0 && mots.every((m) => cible.has(m));
}

// Un nom d'un seul mot ne permet aucune vérification sérieuse : « Morimoto » a retenu un compte
// personnel thaïlandais nommé « Morimoto🌱 », qui serait parti publiquement. Aucun filtre structurel
// ne départage ces cas — on exige donc un nom qualifié (« Morimoto Bordeaux »), sinon pas de mention.
export function nomExploitable(nom) {
  return motsCles(nom).length >= 2;
}

// Signaux d'un compte qui porte le bon nom sans être l'officiel (fan, parodie, revue de presse)
const SUSPECTS = /\b(fan|fans|parodie|parody|non officiel|unofficial|actu|info|news|l'antre|antre)\b/i;

export function suspect(candidat) {
  return SUSPECTS.test(`${candidat.nom ?? ''} ${candidat.description ?? ''}`) || (candidat.abonnes ?? Infinity) < 30;
}

// Ordre de priorité des rôles : le sujet de l'article d'abord, le thème en dernier recours
const POIDS = { sujet: 0, acteur: 1, tutelle: 2, theme: 3 };

// Retient au plus `max` comptes, un seul par entité, en respectant l'ordre des rôles
export function choisir(comptes, { max = 2 } = {}) {
  const vus = new Set();
  return [...comptes]
    .filter((c) => c.handle && !vus.has(fold(c.entite)) && (vus.add(fold(c.entite)) || true))
    .sort((a, b) => (POIDS[a.role] ?? 9) - (POIDS[b.role] ?? 9))
    .slice(0, max);
}

// Mention dans un texte, en remplaçant le nom déjà écrit. Renvoie null si le nom n'y figure pas :
// on n'insère jamais un pseudo au milieu d'une phrase qui ne le nomme pas.
export function substituer(texte, nom, handle) {
  const source = String(texte ?? '');
  const cible = fold(nom);
  if (!cible) return null;
  const plat = fold(source);
  const lettre = /[\p{L}\p{N}]/u;
  for (let at = plat.indexOf(cible); at >= 0; at = plat.indexOf(cible, at + 1)) {
    const avant = source[at - 1] ?? '';
    const apres = source[at + cible.length] ?? '';
    // jamais à l'intérieur d'un hashtag, d'une mention, ni au milieu d'un mot plus long
    if (avant === '#' || avant === '@' || lettre.test(avant) || lettre.test(apres)) continue;
    return `${source.slice(0, at)}@${handle}${source.slice(at + cible.length)}`;
  }
  return null;
}

// Mentions d'un post Bluesky ou Threads : trois au plus, comme les tags d'Instagram.
// Un compte que l'article nomme prend la place de son nom dans le texte (« au @musee_aquitaine ») ;
// les autres — sujet dont le nom n'est pas écrit tel quel, commune, comptes de référence — vont
// ensemble sur une dernière ligne, l'usage de ces réseaux. `tient` dit si le texte reste dans la
// limite du réseau : ce qui ne tient pas n'est pas mentionné, le texte prime toujours.
export function placerMentions(texte, comptes = [], { max = 3, tient = () => true } = {}) {
  let sortie = String(texte ?? '');
  const vus = new Set();
  const uniques = comptes.filter((c) => c?.handle && !vus.has(fold(c.handle)) && vus.add(fold(c.handle))).slice(0, max);
  const places = [];
  const enFin = [];
  for (const c of uniques) {
    const avec = c.thematique ? null : substituer(sortie, c.nom, c.handle);
    if (avec && tient(avec)) {
      sortie = avec;
      places.push(c);
    } else enFin.push(c);
  }
  const ligne = [];
  for (const c of enFin) {
    if (!tient(`${sortie}\n${[...ligne, `@${c.handle}`].join(' ')}`)) break;
    ligne.push(`@${c.handle}`);
    places.push(c);
  }
  if (ligne.length) sortie = `${sortie}\n${ligne.join(' ')}`;
  return { texte: sortie, places };
}
