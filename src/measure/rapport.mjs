// Analyse des relevés : classements, formats, créneaux, effet des mentions.
// Fonctions pures, sans réseau : tout est calculé à partir de state/mesures.json et de l'historique.
//
// Règle absolue : ce module **propose**, il n'applique jamais rien. Aucun réglage n'est modifié
// automatiquement à la lecture d'un rapport — les conseils attendent une validation humaine.

const JOUR = 86400e3;
export const interactions = (m) => (m.likes ?? 0) + (m.commentaires ?? 0) + (m.partages ?? 0);

const moyenne = (liste, f = interactions) => (liste.length ? liste.reduce((n, m) => n + f(m), 0) / liste.length : 0);
const arrondi = (n) => Math.round(n * 10) / 10;

// Créneau horaire lisible : matin (avant 12 h), après-midi, soir
export function creneau(iso, timeZone = 'Europe/Paris') {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso)));
  if (h < 12) return 'matin';
  if (h < 18) return 'après-midi';
  return 'soir';
}

// Un relevé par post : on garde le jalon le plus tardif disponible (J+7 s'il existe, sinon J+1)
export function parPost(mesures) {
  const meilleur = new Map();
  for (const m of mesures) {
    const cle = `${m.guid}|${m.channel}`;
    const connu = meilleur.get(cle);
    if (!connu || m.jalon > connu.jalon) meilleur.set(cle, m);
  }
  return [...meilleur.values()];
}

export function agreger(mesures, { history = [], depuis, jusqu = Date.now() } = {}) {
  const fenetre = parPost(mesures).filter((m) => {
    const t = new Date(m.publieLe).getTime();
    return (!depuis || t >= depuis) && t <= jusqu;
  });

  const detail = fenetre.map((m) => {
    const post = history.find((e) => e.guid === m.guid && e.channel === m.channel);
    return { ...m, format: post?.format ?? null, mention: Boolean(post?.mention), creneau: creneau(m.publieLe) };
  });

  const grouper = (cle) => {
    const groupes = {};
    for (const d of detail) {
      const k = d[cle];
      if (k === null || k === undefined) continue;
      (groupes[k] ??= []).push(d);
    }
    return Object.fromEntries(
      Object.entries(groupes)
        .map(([k, liste]) => [k, { posts: liste.length, moyenne: arrondi(moyenne(liste)) }])
        .sort((a, b) => b[1].moyenne - a[1].moyenne),
    );
  };

  const classe = [...detail].sort((a, b) => interactions(b) - interactions(a));
  const avec = detail.filter((d) => d.mention);
  const sans = detail.filter((d) => !d.mention);

  return {
    posts: detail.length,
    parReseau: grouper('channel'),
    parFormat: grouper('format'),
    parCreneau: grouper('creneau'),
    meilleur: classe[0] ?? null,
    moinsBon: classe.at(-1) ?? null,
    mentions: {
      avec: { posts: avec.length, moyenne: arrondi(moyenne(avec)) },
      sans: { posts: sans.length, moyenne: arrondi(moyenne(sans)) },
    },
  };
}

// Conseils : formulés, jamais appliqués. Chacun dit quoi changer, où, et pourquoi.
export function conseils(bilan) {
  const liste = [];
  const seuil = 5; // en deçà, l'écart n'est pas significatif

  const formats = Object.entries(bilan.parFormat);
  if (formats.length >= 2 && bilan.posts >= seuil) {
    const [meilleur, pire] = [formats[0], formats.at(-1)];
    if (meilleur[1].moyenne >= pire[1].moyenne * 1.5) {
      liste.push(`Le format « ${meilleur[0]} » double presque « ${pire[0]} » (${meilleur[1].moyenne} contre ${pire[1].moyenne} interactions). Si ça se confirme le mois prochain, on peut retirer « ${pire[0]} » de la rotation dans config/channels.json.`);
    }
  }

  const creneaux = Object.entries(bilan.parCreneau);
  if (creneaux.length >= 2 && bilan.posts >= seuil) {
    liste.push(`Meilleur créneau : ${creneaux[0][0]} (${creneaux[0][1].moyenne} interactions en moyenne). Les heures creuses peuvent être resserrées pour publier davantage à ce moment-là.`);
  }

  const { avec, sans } = bilan.mentions;
  if (avec.posts >= 3 && sans.posts >= 3) {
    const ecart = avec.moyenne - sans.moyenne;
    liste.push(ecart > 0
      ? `Les posts avec mention font ${arrondi(ecart)} interactions de plus en moyenne : le mécanisme mérite d'être étendu.`
      : `Les mentions n'apportent rien de mesurable pour l'instant (${avec.moyenne} contre ${sans.moyenne}). À laisser tourner encore un mois avant de conclure.`);
  }

  if (!liste.length) liste.push('Trop peu de recul pour conseiller quoi que ce soit : il faut une dizaine de posts mesurés.');
  return liste;
}

const NOMS = { instagram: 'Instagram', facebook: 'Facebook', bluesky: 'Bluesky', threads: 'Threads', x: 'X' };
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const ligne = (nom, v) => `${esc(nom)} · <b>${v.moyenne}</b> <i>(${v.posts})</i>`;

// Message Telegram : court, lisible d'un coup d'œil, et qui dit clairement que rien n'a été changé.
export function messageHebdo(bilan, { du, au } = {}) {
  const periode = du && au
    ? `${new Date(du).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} – ${new Date(au).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`
    : 'cette semaine';

  if (!bilan.posts) return `📊 <b>Semaine du ${periode}</b>\nAucun post mesuré cette semaine.`;

  const bloc = (titre, obj) => {
    const entrees = Object.entries(obj).slice(0, 4);
    return entrees.length ? `\n<b>${titre}</b>\n${entrees.map(([k, v]) => `· ${ligne(NOMS[k] ?? k, v)}`).join('\n')}` : '';
  };

  const m = bilan.meilleur;
  const p = bilan.moinsBon;
  return [
    `📊 <b>Semaine du ${periode}</b> · ${bilan.posts} posts mesurés`,
    bloc('Par réseau', bilan.parReseau),
    bloc('Par format', bilan.parFormat),
    bloc('Par créneau', bilan.parCreneau),
    m ? `\n🥇 <b>${interactions(m)}</b> interactions · ${NOMS[m.channel] ?? m.channel}\n${esc(m.titre ?? m.guid)}` : '',
    p && p !== m ? `\n🥉 <b>${interactions(p)}</b> · ${NOMS[p.channel] ?? p.channel}` : '',
    `\n💡 <b>Conseils</b>\n${conseils(bilan).map((c) => `· ${esc(c)}`).join('\n')}`,
    '\n<i>Aucun réglage n’a été modifié. Dis-moi ce que tu veux appliquer.</i>',
  ].filter(Boolean).join('\n');
}

// Rapport mensuel : même analyse, stockée pour la page de pilotage
export function rapportMensuel(mesures, history, mois) {
  const debut = new Date(`${mois}-01T00:00:00Z`).getTime();
  const fin = new Date(debut + 32 * JOUR);
  fin.setUTCDate(1);
  const bilan = agreger(mesures, { history, depuis: debut, jusqu: fin.getTime() - 1 });
  return { mois, genereLe: new Date().toISOString(), ...bilan, conseils: conseils(bilan) };
}
