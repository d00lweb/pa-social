import { z } from 'zod';

// Dossier de publication produit par l'IA pour un article (les limites sont contrôlées par guards.mjs)
export const DossierSchema = z.object({
  nature: z.enum(['actu_chaude', 'actu', 'evergreen']),
  sensible: z.boolean(),
  rubrique: z.string(),
  visuel: z.object({
    titre: z.string(),
    surlignage: z.string(),
    description: z.string(),
    texte_alternatif: z.string(),
  }),
  // entités réellement citées ou impliquées, par ordre de pertinence ; liste vide si aucune
  entites: z.array(z.object({ nom: z.string(), role: z.enum(['sujet', 'acteur', 'tutelle', 'theme']) })),
  // localisation du sujet : du plus précis au plus large, chaîne vide si inconnu
  lieu: z.object({ precis: z.string(), ville: z.string(), departement: z.string() }),
  instagram: z.object({ texte: z.string(), hashtags: z.array(z.string()) }),
  facebook: z.object({ texte: z.string() }),
  bluesky: z.object({ texte: z.string(), hashtag: z.string() }),
  threads: z.object({ texte: z.string(), sujet: z.string() }),
  x: z.object({ texte: z.string() }),
});
