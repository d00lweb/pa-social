import { loadJson, saveJson } from '../core/state.mjs';
import { dayKey, localHour } from '../core/scheduler.mjs';
import { send } from '../channels/telegram.mjs';
import { config } from '../core/config.mjs';
import { agreger, messageHebdo, rapportMensuel } from './rapport.mjs';

// Quand diffuser les rapports. Le robot passe toutes les 20 minutes : un marqueur d'état
// garantit un seul envoi par semaine et un seul rapport par mois.
const TZ = config.timezone;
const JOUR = 86400e3;

const jourSemaine = (ms, tz = TZ) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' }).format(new Date(ms));
export const estLundi = (ms, tz = TZ) => jourSemaine(ms, tz) === 'Mon';
export const mois = (ms, tz = TZ) => dayKey(ms, tz).slice(0, 7);

// Lundi matin, après 8 h, une seule fois
export function dueHebdo(etat, ms, tz = TZ) {
  if (!estLundi(ms, tz) || localHour(ms, tz) < 8) return false;
  return etat?.dernierHebdo !== dayKey(ms, tz);
}

// Le mois précédent est clos : on le fige une seule fois, dès le 1er passage du nouveau mois
export function dueMensuel(etat, ms, tz = TZ) {
  const precedent = mois(new Date(ms).getTime() - 3 * JOUR, tz) === mois(ms, tz)
    ? null
    : mois(new Date(ms).getTime() - 3 * JOUR, tz);
  if (!precedent) return null;
  return etat?.dernierMensuel === precedent ? null : precedent;
}

// Diffuse ce qui est dû. Ne modifie aucun réglage : les conseils partent en texte, c'est tout.
export async function diffuser({ history = [], mesures = [], now = Date.now(), log = console.log } = {}) {
  const etat = await loadJson('rapports/etat.json', {});
  const index = await loadJson('rapports/index.json', []);
  let change = false;

  if (dueHebdo(etat, now)) {
    const du = now - 7 * JOUR;
    const bilan = agreger(mesures, { history, depuis: du, jusqu: now });
    await send(messageHebdo(bilan, { du, au: now }));
    etat.dernierHebdo = dayKey(now, TZ);
    change = true;
    log(`Rapport hebdomadaire envoyé (${bilan.posts} posts mesurés).`);
  }

  const aFiger = dueMensuel(etat, now);
  if (aFiger) {
    const rapport = rapportMensuel(mesures, history, aFiger);
    await saveJson(`rapports/${aFiger}.json`, rapport);
    if (!index.includes(aFiger)) index.unshift(aFiger);
    await saveJson('rapports/index.json', index.slice(0, 24));
    etat.dernierMensuel = aFiger;
    change = true;
    log(`Rapport mensuel ${aFiger} figé (${rapport.posts} posts).`);
  }

  if (change) await saveJson('rapports/etat.json', etat);
  return { index };
}
