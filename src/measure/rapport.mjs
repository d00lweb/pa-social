// Analyse des relevés : classements, formats, créneaux, effet des mentions.
// Fonctions pures, sans réseau : tout est calculé à partir de state/mesures.json et de l'historique.
//
// Règle absolue : ce module **propose**, il n'applique jamais rien. Aucun réglage n'est modifié
// automatiquement à la lecture d'un rapport — les conseils attendent une validation humaine.

import { config } from '../core/config.mjs';
import { creneauDe } from '../core/scheduler.mjs';
import { evolution, SUIVIS } from './abonnes.mjs';

const JOUR = 86400e3;
export const interactions = (m) => (m.likes ?? 0) + (m.commentaires ?? 0) + (m.partages ?? 0);

const hh = (s) => {
  const [h, m] = String(s).split(':').map(Number);
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
};

// Créneau du réseau dans lequel le post est parti (« 20 h – 21 h 30 ») : c'est ce qui permet de
// vérifier, réseau par réseau, la stratégie horaire posée le 18/09/2026.
export function creneauReseau(iso, channel, canaux = config.channels, timeZone = config.timezone) {
  const creneaux = canaux[channel]?.creneaux;
  if (!creneaux) return null;
  const i = creneauDe(new Date(iso).getTime(), creneaux, timeZone, 0.25);
  return i < 0 ? 'hors créneau' : `${hh(creneaux[i][0])} – ${hh(creneaux[i][1])}`;
}

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
  // Les relevés marqués « introuvable » ne portent aucun chiffre : ils n'existent que pour clore
  // un jalon dont le post a disparu chez le réseau. Les compter tirerait les moyennes vers zéro.
  for (const m of mesures.filter((x) => !x.introuvable)) {
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
    return {
      ...m,
      titre: m.titre ?? post?.titre ?? null,
      lien: post?.lienPost ?? post?.lien ?? null,
      format: post?.format ?? null,
      mention: Boolean(post?.mention),
      creneau: creneau(m.publieLe),
      creneauReseau: creneauReseau(m.publieLe, m.channel),
    };
  });

  // Par réseau, puis par créneau de ce réseau, du plus performant au moins performant
  const parCreneauReseau = {};
  for (const d of detail) {
    if (!d.creneauReseau) continue;
    ((parCreneauReseau[d.channel] ??= {})[d.creneauReseau] ??= []).push(d);
  }
  const creneauxParReseau = Object.fromEntries(Object.entries(parCreneauReseau).map(([c, groupes]) => [c, Object.fromEntries(
    Object.entries(groupes).map(([k, l]) => [k, { posts: l.length, moyenne: arrondi(moyenne(l)) }]).sort((a, b) => b[1].moyenne - a[1].moyenne),
  )]));

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
    parCreneauReseau: creneauxParReseau,
    interactionsTotal: detail.reduce((n, d) => n + interactions(d), 0),
    meilleur: classe[0] ?? null,
    moinsBon: classe.at(-1) ?? null,
    mentions: {
      avec: { posts: avec.length, moyenne: arrondi(moyenne(avec)) },
      sans: { posts: sans.length, moyenne: arrondi(moyenne(sans)) },
    },
  };
}

const NOMS = { instagram: 'Instagram', facebook: 'Facebook', bluesky: 'Bluesky', threads: 'Threads', x: 'X' };
const signe = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('fr-FR')}`;
const fois = (a, b) => String(Math.round((a / b) * 10) / 10).replace('.', ',');
const pourcent = (n) => String(n).replace('.', ',');

// Conseils : formulés, jamais appliqués. Chacun dit quoi changer, où, et pourquoi — quatre au plus,
// pour rester lisibles. Un écart n'est retenu que s'il repose sur assez de posts pour compter.
export function conseils(bilan, { abonnes = {}, engagement = {} } = {}) {
  const liste = [];
  const seuil = 5; // en deçà, l'écart n'est pas significatif

  // 1. la stratégie horaire, réseau par réseau : un créneau nettement meilleur que l'autre
  for (const [id, creneaux] of Object.entries(bilan.parCreneauReseau ?? {})) {
    const c = Object.entries(creneaux).filter(([k, v]) => k !== 'hors créneau' && v.posts >= 3);
    if (c.length >= 2 && c.at(-1)[1].moyenne > 0 && c[0][1].moyenne >= c.at(-1)[1].moyenne * 1.5) {
      liste.push(`${NOMS[id] ?? id} : le créneau ${c[0][0]} fait ${fois(c[0][1].moyenne, c.at(-1)[1].moyenne)} fois mieux que ${c.at(-1)[0]} (${c[0][1].moyenne} contre ${c.at(-1)[1].moyenne} interactions par post). Si ça se confirme, on peut y renforcer la présence dans config/channels.json.`);
    }
  }

  // 2. le format
  const formats = Object.entries(bilan.parFormat);
  if (formats.length >= 2 && bilan.posts >= seuil) {
    const [meilleur, pire] = [formats[0], formats.at(-1)];
    if (meilleur[1].moyenne >= pire[1].moyenne * 1.5) {
      liste.push(`Le format « ${meilleur[0]} » fait ${fois(meilleur[1].moyenne, Math.max(pire[1].moyenne, 0.1))} fois mieux que « ${pire[0]} » (${meilleur[1].moyenne} contre ${pire[1].moyenne} interactions). Si ça se confirme le mois prochain, on peut retirer « ${pire[0]} » de la rotation dans config/channels.json.`);
    }
  }

  // 3. les abonnés : qui progresse, qui recule
  // (jamais sans vraie période à comparer : le premier jour, « progresse le plus » ne voudrait rien dire)
  const croissances = Object.entries(abonnes).filter(([, e]) => e && e.debut >= 100 && e.pct !== null && e.depuis !== e.au).sort((a, b) => b[1].pct - a[1].pct);
  if (croissances.length >= 2 && croissances.some(([, e]) => e.gain !== 0)) {
    const [haut] = croissances;
    const bas = croissances.at(-1);
    const tete = haut[1].gain > 0 ? `${NOMS[haut[0]]} progresse le plus (${signe(haut[1].gain)}, ${signe(haut[1].pct)} %)` : 'aucun compte ne progresse';
    liste.push(`Abonnés : ${tete}${bas[1].gain < 0 ? ` ; ${NOMS[bas[0]]} recule (${signe(bas[1].gain)}), à surveiller` : ''}.`);
  }

  // 4. l'engagement rapporté aux abonnés : où chaque post compte le plus
  const taux = Object.entries(engagement).sort((a, b) => b[1] - a[1]);
  if (taux.length >= 2 && taux.at(-1)[1] > 0 && taux[0][1] >= taux.at(-1)[1] * 2) {
    liste.push(`Rapporté aux abonnés, ${NOMS[taux[0][0]]} engage ${fois(taux[0][1], taux.at(-1)[1])} fois plus que ${NOMS[taux.at(-1)[0]]} (${pourcent(taux[0][1])} % contre ${pourcent(taux.at(-1)[1])} %) : c’est là que chaque post compte le plus.`);
  }

  // 5. les mentions
  const { avec, sans } = bilan.mentions;
  if (avec.posts >= 3 && sans.posts >= 3) {
    const ecart = avec.moyenne - sans.moyenne;
    liste.push(ecart > 0
      ? `Les posts avec mention font ${arrondi(ecart)} interactions de plus en moyenne : le mécanisme mérite d'être étendu.`
      : `Les mentions n'apportent rien de mesurable pour l'instant (${avec.moyenne} contre ${sans.moyenne}). À laisser tourner encore un mois avant de conclure.`);
  }

  if (!liste.length) liste.push('Trop peu de recul pour conseiller quoi que ce soit : il faut une dizaine de posts mesurés.');
  return liste.slice(0, 4);
}
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const ligne = (nom, v) => `${esc(nom)} · <b>${v.moyenne}</b> <i>(${v.posts})</i>`;

// Message Telegram : court, lisible d'un coup d'œil, et qui dit clairement que rien n'a été changé.
export function messageHebdo(bilan, { du, au, abonnes = {} } = {}) {
  const periode = du && au
    ? `${new Date(du).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} – ${new Date(au).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`
    : 'cette semaine';
  const gains = Object.entries(abonnes).filter(([, e]) => e && e.au !== e.depuis).map(([id, e]) => `${NOMS[id] ?? id} ${signe(e.gain)}`);
  const ligneAbonnes = gains.length ? `👥 <b>Abonnés</b> · ${gains.join(' · ')}` : '';

  if (!bilan.posts) return [`📊 <b>Semaine du ${periode}</b>`, ligneAbonnes, 'Aucun post mesuré cette semaine.'].filter(Boolean).join('\n');

  const bloc = (titre, obj) => {
    const entrees = Object.entries(obj).slice(0, 4);
    return entrees.length ? `\n<b>${titre}</b>\n${entrees.map(([k, v]) => `· ${ligne(NOMS[k] ?? k, v)}`).join('\n')}` : '';
  };

  const m = bilan.meilleur;
  const p = bilan.moinsBon;
  return [
    `📊 <b>Semaine du ${periode}</b> · ${bilan.posts} posts mesurés`,
    ligneAbonnes,
    bloc('Par réseau', bilan.parReseau),
    bloc('Par format', bilan.parFormat),
    bloc('Par créneau', bilan.parCreneau),
    m ? `\n🥇 <b>${interactions(m)}</b> interactions · ${NOMS[m.channel] ?? m.channel}\n${esc(m.titre ?? m.guid)}` : '',
    p && p !== m ? `\n🥉 <b>${interactions(p)}</b> · ${NOMS[p.channel] ?? p.channel}` : '',
    `\n💡 <b>Conseils</b>\n${conseils(bilan).map((c) => `· ${esc(c)}`).join('\n')}`,
    '\n<i>Aucun réglage n’a été modifié. Dis-moi ce que tu veux appliquer.</i>',
  ].filter(Boolean).join('\n');
}

// Rapport mensuel : figé le 1er du mois suivant, et calculé à chaque passage pour le mois en cours.
// Court par principe : abonnés, publications, engagement, ce qui a marché, quatre conseils au plus.
export function rapportMensuel(mesures, history, mois, { releves = {} } = {}) {
  const debut = new Date(`${mois}-01T00:00:00Z`).getTime();
  const fin = new Date(debut + 32 * JOUR);
  fin.setUTCDate(1);
  const bilan = agreger(mesures, { history, depuis: debut, jusqu: fin.getTime() - 1 });
  const dernierJour = new Date(fin.getTime() - JOUR).toISOString().slice(0, 10);

  // posts réellement publiés dans le mois, mesurés ou non (le kit X compte : il est parti sur Telegram)
  const publies = {};
  for (const e of history) {
    const t = Date.parse(e.at);
    if (t >= debut && t < fin.getTime()) publies[e.channel] = (publies[e.channel] ?? 0) + 1;
  }
  const abonnes = Object.fromEntries(SUIVIS.map((id) => [id, evolution(releves, id, `${mois}-01`, dernierJour)]));
  // taux d'engagement : interactions moyennes par post, rapportées aux abonnés du compte. Seul chiffre
  // qui compare honnêtement un compte de 42 000 abonnés et un compte de 1 000. Pas en dessous de 100
  // abonnés, où le taux ne veut plus rien dire.
  const engagement = Object.fromEntries(
    Object.entries(bilan.parReseau)
      .filter(([id]) => abonnes[id]?.fin >= 100)
      .map(([id, v]) => [id, Math.round((v.moyenne / abonnes[id].fin) * 10000) / 100]),
  );
  return { mois, genereLe: new Date().toISOString(), ...bilan, publies, abonnes, engagement, conseils: conseils(bilan, { abonnes, engagement }) };
}

// Bilan du mois sur Telegram, le 1er : les chiffres qui comptent, deux conseils, et le lien vers le détail
export function messageMensuel(r) {
  const nomMois = new Date(`${r.mois}-15T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const suivis = Object.entries(r.abonnes ?? {}).filter(([, e]) => e);
  const gain = suivis.reduce((s, [, e]) => s + e.gain, 0);
  const publies = Object.values(r.publies ?? {}).reduce((s, n) => s + n, 0);
  const m = r.meilleur;
  return [
    `📈 <b>Bilan de ${nomMois}</b>`,
    `${publies} posts publiés · ${signe(gain)} abonnés · ${r.posts} posts mesurés`,
    suivis.length ? `\n<b>Abonnés</b>\n${suivis.map(([id, e]) => `· ${NOMS[id]} ${e.fin.toLocaleString('fr-FR')} (${signe(e.gain)})`).join('\n')}` : '',
    m ? `\n🥇 ${esc(m.titre ?? '')} · ${NOMS[m.channel] ?? m.channel}, ${interactions(m)} interactions` : '',
    `\n💡 <b>À retenir</b>\n${(r.conseils ?? []).slice(0, 2).map((c) => `· ${esc(c)}`).join('\n')}`,
    '\n<i>Rapport complet sur la page de pilotage. Aucun réglage n’a été modifié.</i>',
  ].filter(Boolean).join('\n');
}
