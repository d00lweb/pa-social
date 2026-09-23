// Lecture des exports CSV de la console Anthropic (Settings → Usage → Export).
//
// Deux exports coexistent et ne disent pas la même chose :
//   · l'export des coûts donne le montant facturé, mais avec quelques heures de retard ;
//   · l'export des jetons est à jour, et le coût se recalcule à la grille publique.
// On retient le plus élevé des deux pour chaque jour : un chiffre de dépense ne doit jamais
// être flatteur. Les deux fichiers portent la colonne `api_key`, ce qui permet d'isoler
// ce projet des autres clés du même compte.
import { cout, tarifDe } from './couts.mjs';

// Découpe une ligne CSV en respectant les champs entre guillemets.
export function champs(ligne) {
  const out = [];
  let courant = '';
  let entreGuillemets = false;
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];
    if (c === '"') {
      if (entreGuillemets && ligne[i + 1] === '"') { courant += '"'; i += 1; } else entreGuillemets = !entreGuillemets;
    } else if (c === ',' && !entreGuillemets) {
      out.push(courant); courant = '';
    } else courant += c;
  }
  out.push(courant);
  return out.map((s) => s.trim());
}

export function lignesCsv(texte) {
  const lignes = texte.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lignes.length) return [];
  const entete = champs(lignes[0]);
  return lignes.slice(1).map((l) => Object.fromEntries(champs(l).map((v, i) => [entete[i], v])));
}

const nombre = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

// Dépense par jour, en dollars, pour une clé donnée.
export function joursDunExport(texte, cle) {
  const lignes = lignesCsv(texte);
  if (!lignes.length) return {};
  const parJour = {};
  const garder = (l) => !cle || l.api_key === cle;

  if ('cost_usd' in lignes[0]) {
    for (const l of lignes.filter(garder)) {
      const jour = l.usage_date_utc;
      if (!jour) continue;
      parJour[jour] = (parJour[jour] ?? 0) + nombre(l.cost_usd);
    }
    return parJour;
  }

  if ('usage_input_tokens_no_cache' in lignes[0]) {
    for (const l of lignes.filter(garder)) {
      const jour = l.usage_date_utc;
      if (!jour) continue;
      const usage = {
        input_tokens: nombre(l.usage_input_tokens_no_cache),
        output_tokens: nombre(l.usage_output_tokens),
        cache_read_input_tokens: nombre(l.usage_input_tokens_cache_read),
        cache_creation_input_tokens: nombre(l.usage_input_tokens_cache_write_5m) + nombre(l.usage_input_tokens_cache_write_1h),
      };
      parJour[jour] = (parJour[jour] ?? 0) + cout(usage, l.model_version);
    }
    return parJour;
  }

  throw new Error('Colonnes inconnues : ni export de coûts (cost_usd), ni export de jetons (usage_input_tokens_no_cache).');
}

// Fusionne plusieurs exports : pour chaque jour, le montant le plus élevé.
export function fusionnerExports(textes, cle) {
  const jours = {};
  for (const texte of textes) {
    for (const [jour, montant] of Object.entries(joursDunExport(texte, cle))) {
      jours[jour] = Math.round(Math.max(jours[jour] ?? 0, montant) * 1e6) / 1e6;
    }
  }
  return jours;
}

// Modèles vus dans un export de jetons, avec leur poids : de quoi vérifier qu'aucun appel
// inattendu ne s'est glissé sur la clé.
export function modelesDunExport(texte, cle) {
  const parModele = {};
  for (const l of lignesCsv(texte)) {
    if (!('model_version' in l) || (cle && l.api_key !== cle)) continue;
    const m = String(l.model_version).replace(/-\d{8}$/, '');
    const usage = {
      input_tokens: nombre(l.usage_input_tokens_no_cache),
      output_tokens: nombre(l.usage_output_tokens),
      cache_read_input_tokens: nombre(l.usage_input_tokens_cache_read),
      cache_creation_input_tokens: nombre(l.usage_input_tokens_cache_write_5m) + nombre(l.usage_input_tokens_cache_write_1h),
    };
    parModele[m] = (parModele[m] ?? 0) + cout(usage, l.model_version);
    void tarifDe(l.model_version);
  }
  return parModele;
}
