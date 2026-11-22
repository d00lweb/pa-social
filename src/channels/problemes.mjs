import { loadJson, saveJson } from '../core/state.mjs';
import { config } from '../core/config.mjs';
import { isQuiet } from '../core/scheduler.mjs';
import { sansSecret } from '../core/errors.mjs';
import { notificationActive, rappel as texteRappel } from './messages.mjs';

// Ce qui part sur Telegram sans être demandé passe par ici (22/11/2026, « j'en reçois trop, en doublon »).
//  - Un message unique (kit X, story) ne part qu'une fois par clé : `unSeul`.
//  - Un problème (jeton refusé, flux en panne…) part une fois, un rappel au plus par semaine tant qu'il
//    dure, puis un court « réglé » quand il disparaît : `signaler`, `regler`, `distribuer`.
//  - Un problème qui ne dure qu'un passage (un appel raté) ne part pas : `delaiMinutes`.
//  - Rien ne part la nuit (22 h – 8 h) : ce qui attend part au premier passage du matin.
// État : state/problemes.json, écrit seulement par le passage du robot (`activerDisque`), jamais par
// un test ni par un script lancé sur un poste.
export const RAPPEL_JOURS = 7;
export const GARDE_JOURS = 30;
export const DELAI_MINUTES = 40; // deux passages : un incident d'un seul passage reste muet
export const CORRECTION_HEURES = 2; // au-delà, un réseau de plus fait un nouveau message (une correction ne sonne pas)
export const NUIT = { start: 22, end: 8 };
const JOUR = 86400e3;
const FICHIER = 'problemes.json';
const vide = () => ({ v: 1, ouverts: {}, attente: [], envoyes: {} });

const enTest = Boolean(process.env.NODE_TEST_CONTEXT);
let cache = null;
let surDisque = false;
export const activerDisque = () => { surDisque = !enTest; };
export async function etatDesProblemes() {
  if (cache) return cache;
  let lu = {};
  // fichier illisible : on repart d'un état vide plutôt que d'arrêter le passage
  if (!enTest) lu = await loadJson(FICHIER, vide()).catch((e) => { console.error(`${FICHIER} illisible (${e.message}) : état vide`); return {}; });
  cache = { ...vide(), ...lu };
  return cache;
}
const sauver = async () => cache && surDisque && saveJson(FICHIER, cache);
// tests : un état neuf, gardé en mémoire
export const reinitialiser = (etat = vide()) => { cache = { ...vide(), ...etat }; return cache; };

export const nuit = (maintenant, timeZone = config.timezone) => isQuiet(maintenant, NUIT, timeZone);
// rien de ce qui est gardé dans l'état (dépôt public) ne contient un jeton recopié par un réseau
const propre = (message) => ({ ...message, text: sansSecret(message.text), ...(message.reply_markup ? { reply_markup: sansSecret(message.reply_markup) } : {}) });
// une erreur du registre ne doit jamais faire échouer une publication
const sur = (nom, f) => async (...args) => {
  try {
    return await f(...args);
  } catch (e) {
    console.error(`Telegram (${nom}) : ${e.message}`);
    return false;
  }
};

// Un message qui ne doit partir qu'une fois (même clé, même article). Rend vrai s'il est parti.
// L'envoi lui-même peut échouer et le dire : le kit X est alors réessayé ; une fois parti, il ne repart plus.
export async function unSeul(cle, envoyer, { maintenant = Date.now() } = {}) {
  const etat = await etatDesProblemes();
  if (etat.envoyes[cle]) {
    console.log(`   Telegram : « ${cle} » déjà envoyé le ${etat.envoyes[cle].slice(0, 16)}, pas de doublon`);
    return false;
  }
  await envoyer();
  etat.envoyes[cle] = new Date(maintenant).toISOString();
  await sauver().catch((e) => console.error(`${FICHIER} non écrit : ${e.message}`));
  return true;
}

// Un problème apparaît ou dure. `message` : { text, reply_markup? } ; `type` : son interrupteur
// (config/notifications.json) ; `rappel` : faux pour un fait ponctuel (publication ratée), qui part
// tout de suite ; `editable` : le message se complète (un réseau de plus) ; `delaiMinutes` : temps
// avant la première annonce, pour qu'un incident d'un seul passage reste muet.
export const signaler = sur('signaler', async (cle, { type, message, rappel = true, editable = false, dureeJours = null, donnees = null, delaiMinutes = null, maintenant = Date.now() }) => {
  const etat = await etatDesProblemes();
  const m = propre(message);
  // rouvert avant que son « réglé » soit parti : le « réglé » est annulé, rien de neuf n'est annoncé
  const enAttente = etat.attente.findIndex((a) => a.cle === cle);
  if (enAttente >= 0 && !etat.ouverts[cle] && etat.attente[enAttente].ancien) {
    etat.ouverts[cle] = etat.attente[enAttente].ancien;
    etat.attente.splice(enAttente, 1);
  }
  const o = etat.ouverts[cle];
  const finLe = dureeJours ? new Date(maintenant + dureeJours * JOUR).toISOString() : null;
  const delai = delaiMinutes ?? (rappel ? DELAI_MINUTES : 0);
  if (!o) etat.ouverts[cle] = { type, depuis: new Date(maintenant).toISOString(), annonceDes: new Date(maintenant + delai * 60e3).toISOString(), message: m, rappel, editable, finLe, donnees, envoye: null, rappele: null, messageId: null };
  else Object.assign(o, { message: m, ...(donnees ? { donnees } : {}), ...(finLe && !o.finLe ? { finLe } : {}) });
  await sauver();
  return true;
});

// Le problème a disparu : un court « réglé » s'il avait été annoncé (sauf `silencieux`).
export const regler = sur('regler', async (cle, { message = null, silencieux = false } = {}) => {
  const etat = await etatDesProblemes();
  const o = etat.ouverts[cle];
  if (!o) return false;
  delete etat.ouverts[cle];
  if (o.envoye && message && !silencieux) etat.attente.push({ cle, type: o.type, message: propre(message), ancien: o });
  await sauver();
  return true;
});

// Un problème à plusieurs causes (le jeton Meta refusé sur Instagram, sur Facebook, à la vérification
// du jour) : un seul message ; « réglé » quand la dernière cause a disparu.
export const ajouterCause = sur('cause', async (cle, cause, options) => {
  const etat = await etatDesProblemes();
  const causes = [...new Set([...(etat.ouverts[cle]?.donnees?.causes ?? []), cause])];
  return signaler(cle, { ...options, donnees: { causes } });
});
export const retirerCause = sur('cause', async (cle, cause, options = {}) => {
  const etat = await etatDesProblemes();
  const o = etat.ouverts[cle];
  if (!o) return false;
  const causes = (o.donnees?.causes ?? []).filter((c) => c !== cause);
  if (causes.length) {
    o.donnees = { ...o.donnees, causes };
    await sauver();
    return false;
  }
  return regler(cle, options);
});

export const ouverts = async (prefixe = '') => Object.keys((await etatDesProblemes()).ouverts).filter((c) => c.startsWith(prefixe));

// Envoie ce qui doit partir : les « réglé » en attente, les problèmes dont l'annonce est due, les
// rappels, les compléments. Un envoi raté reste dû au passage suivant.
export async function distribuer({ maintenant = Date.now(), envoyer, editer = async () => {}, log = console.log } = {}) {
  const etat = await etatDesProblemes();
  let envoyes = 0;
  // ménage : faits ponctuels expirés, clés anti-doublon de plus d'un mois
  for (const [cle, o] of Object.entries(etat.ouverts)) if (o.finLe && Date.parse(o.finLe) <= maintenant) delete etat.ouverts[cle];
  for (const [cle, quand] of Object.entries(etat.envoyes)) if (maintenant - Date.parse(quand) > GARDE_JOURS * JOUR) delete etat.envoyes[cle];

  if (nuit(maintenant)) {
    await sauver();
    return 0;
  }
  const actif = (type) => notificationActive(type);
  const maintenantIso = new Date(maintenant).toISOString();
  for (const a of [...etat.attente]) {
    try {
      if (actif(a.type)) await envoyer(a.message);
      etat.attente.splice(etat.attente.indexOf(a), 1);
      envoyes++;
    } catch (e) {
      log(`   Telegram : « réglé » non envoyé (${e.message}), nouvel essai au passage suivant`);
    }
  }
  for (const [cle, o] of Object.entries(etat.ouverts)) {
    const texte = o.message?.text;
    try {
      if (!o.envoye) {
        if (o.annonceDes && Date.parse(o.annonceDes) > maintenant) continue;
        // coupé dans les réglages : noté comme annoncé, pour ne pas partir le jour où on le rallume
        const r = actif(o.type) ? await envoyer(o.message) : null;
        Object.assign(o, { envoye: maintenantIso, rappele: maintenantIso, messageId: r?.message_id ?? null, texteEnvoye: texte });
        envoyes++;
      } else if (o.editable && texte !== o.texteEnvoye) {
        // un réseau de plus : corrigé en place si le message est récent, sinon un nouveau message
        const recent = o.messageId && maintenant - Date.parse(o.envoye) < CORRECTION_HEURES * 3600e3;
        const corrige = recent && await editer(o.messageId, o.message).then(() => true, (e) => { log(`   Telegram : correction de « ${cle} » impossible (${e.message})`); return false; });
        if (!corrige) {
          const r = actif(o.type) ? await envoyer(o.message) : null;
          Object.assign(o, { envoye: maintenantIso, messageId: r?.message_id ?? null });
          envoyes++;
        }
        o.texteEnvoye = texte;
      } else if (o.rappel && maintenant - Date.parse(o.rappele) >= RAPPEL_JOURS * JOUR) {
        if (actif(o.type)) await envoyer(texteRappel(o.message, o.depuis));
        o.rappele = maintenantIso;
        envoyes++;
      }
    } catch (e) {
      log(`   Telegram : « ${cle} » non envoyé (${e.message}), nouvel essai au passage suivant`);
    }
  }
  await sauver();
  if (envoyes) log(`Telegram : ${envoyes} message${envoyes > 1 ? 's' : ''} de suivi des problèmes.`);
  return envoyes;
}
