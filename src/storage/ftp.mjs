import { Readable } from 'node:stream';
import { Client } from 'basic-ftp';

// FTPS explicite (o2switch ferme SSH aux IP non autorisées, dont GitHub Actions)
// SFTP_HOST accepte « hôte » ou « hôte:port » ; SFTP_DIR « / » = racine du compte FTP
export async function uploadFiles(files, { host, user, pass, dir }) {
  const [hostname, port = '21'] = host.split(':');
  const client = new Client(30000);
  try {
    try {
      await client.access({ host: hostname, port: Number(port), user, password: pass, secure: true });
    } catch (e) {
      if (e.code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
        throw new Error(`Certificat FTP émis pour un autre nom que ${hostname} : mettre dans SFTP_HOST le nom du serveur (ex. pasta.o2switch.net)`);
      }
      throw e;
    }
    // chemin relatif au compte FTP (enfermé dans son dossier) ; « / » = racine du compte
    if (dir && dir !== '/') {
      try {
        await client.cd(dir);
      } catch {
        throw new Error(`Dossier FTP introuvable dans le compte : ${dir} (le compte démarre dans son propre dossier : SFTP_DIR=/ s'il pointe déjà sur social)`);
      }
    }
    for (const { name, buffer } of files) {
      await client.uploadFrom(Readable.from(buffer), name);
    }
  } finally {
    client.close();
  }
}

// Meta télécharge l'image : elle doit être servie publiquement en JPEG
export async function assertPublic(url) {
  const res = await fetch(url, { cache: 'no-store', redirect: 'manual' });
  await res.body?.cancel();
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.startsWith('image/')) {
    throw new Error(`Image non accessible publiquement (${res.status} ${type}) : ${url}`);
  }
}
