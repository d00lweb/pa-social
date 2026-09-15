// Test d'accès Bluesky (connexion seulement, aucune publication) : npm run smoke:bsky
import { login } from '../src/channels/bluesky.mjs';

if (!process.env.BLUESKY_HANDLE || !process.env.BLUESKY_APP_PASSWORD) {
  console.error('BLUESKY_HANDLE et BLUESKY_APP_PASSWORD requis dans .env');
  process.exit(1);
}
try {
  const { handle, did } = await login();
  console.log(`Connexion Bluesky OK : @${handle} (${did})`);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
