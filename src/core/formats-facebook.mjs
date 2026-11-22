import { config } from './config.mjs';
import { dayKey } from './scheduler.mjs';

// Facebook : le format de chaque publication, lu dans config/channels.json (facebook.format, facebook.test).
// Test « photo ou lien » : un format par jour, à tour de rôle, du premier au dernier jour inclus,
// les deux publications du jour dans le même format. Hors test : le format par défaut.
export const FORMATS_FACEBOOK = ['lien', 'photo'];
const JOUR = 86400e3;
const FORME_JOUR = /^\d{4}-\d{2}-\d{2}$/;
const minuitUtc = (j) => Date.parse(`${j}T00:00:00Z`);

export const formatParDefaut = (canal = config.channels.facebook) => (FORMATS_FACEBOOK.includes(canal?.format) ? canal.format : 'lien');

// Le test tel que la configuration le décrit ; null s'il est coupé ou mal écrit (rien ne change alors)
export function testFacebook(canal = config.channels.facebook) {
  const t = canal?.test;
  if (!t || t.actif === false) return null;
  if (!FORME_JOUR.test(String(t.debut)) || !FORME_JOUR.test(String(t.fin)) || t.fin < t.debut) return null;
  if (!Array.isArray(t.formats) || !t.formats.every((f) => FORMATS_FACEBOOK.includes(f)) || new Set(t.formats).size < 2) return null;
  if ((t.alternance ?? 'jour') !== 'jour') return null;
  return { debut: t.debut, fin: t.fin, formats: [...t.formats], jours: Math.round((minuitUtc(t.fin) - minuitUtc(t.debut)) / JOUR) + 1 };
}

// Jour du test où tombe cet instant (heure de Paris) : { jour: 1 à N, jours, format, debut, fin }, ou null
export function jourDuTest(ms, canal = config.channels.facebook, timeZone = config.timezone) {
  const t = testFacebook(canal);
  if (!t) return null;
  const j = dayKey(ms, timeZone);
  if (j < t.debut || j > t.fin) return null;
  const i = Math.round((minuitUtc(j) - minuitUtc(t.debut)) / JOUR);
  return { jour: i + 1, jours: t.jours, format: t.formats[i % t.formats.length], debut: t.debut, fin: t.fin };
}

// Format d'une publication Facebook faite à cet instant
export const formatFacebook = (ms, canal = config.channels.facebook, timeZone = config.timezone) =>
  jourDuTest(ms, canal, timeZone)?.format ?? formatParDefaut(canal);

// Adresse de l'article marquée de son format (facebook.utm, « {format} » remplacé) ; intacte sans modèle
export function lienMarque(url, format, canal = config.channels.facebook) {
  if (!canal?.utm) return url;
  try {
    const u = new URL(url);
    for (const [k, v] of new URLSearchParams(String(canal.utm).replaceAll('{format}', format))) u.searchParams.set(k, v);
    return u.href;
  } catch {
    return url;
  }
}
