import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { DossierSchema } from './schema.mjs';

let client;

// Un appel Claude : sortie JSON contrainte par le schéma, repli serveur automatique en cas de refus
export async function askEditor({ system, payload, model, effort }) {
  client ??= new Anthropic();
  const response = await client.beta.messages.create({
    model,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    output_config: { effort, format: zodOutputFormat(DossierSchema) },
    messages: [{ role: 'user', content: JSON.stringify(payload, null, 1) }],
  });

  if (response.stop_reason === 'refusal') throw new Error('refus du modèle');
  if (response.stop_reason === 'max_tokens') throw new Error('réponse tronquée');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const parsed = DossierSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`JSON hors schéma : ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join(' ; ')}`);
  return { dossier: parsed.data, usage: response.usage, model: response.model };
}
