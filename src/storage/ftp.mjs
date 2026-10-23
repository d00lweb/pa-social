import { Readable } from 'node:stream';
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { Client } from 'basic-ftp';

// Chaîne de certificats incomplète. Le 23/10/2026, le serveur FTPS d'o2switch (certificat Let's
// Encrypt renouvelé le 04/09) ne présentait plus ses certificats intermédiaires : Node ne sait pas
// les chercher seul (un navigateur, si) et refusait la connexion — « unable to verify the first
// certificate » —, si bien qu'aucune image ne se déposait plus : ni Instagram, ni Threads, ni
// aperçus, ni page de l'équipe. On complète donc la chaîne comme un navigateur : on lit le
// certificat présenté, sans rien envoyer d'autre, puis on télécharge ses maillons aux adresses
// qu'il indique lui-même (AIA), jusqu'à un certificat signé par une racine connue de Node. La
// connexion reste vérifiée de bout en bout, chaîne et nom du serveur : un maillon téléchargé ne
// sert qu'à construire le chemin, il n'est jamais cru sur parole.
const CHAINE_INCOMPLETE = new Set(['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY']);
const MAILLONS_MAX = 4;
const chainesCompletees = new Map(); // hôte → autorités à utiliser, le temps d'une exécution

// Adresse du premier maillon manquant, lue sur le certificat présenté : sonde sans identifiants
async function sonderAia(hostname, port) {
  const sonde = new Client(20000);
  try {
    await sonde.connect(hostname, port);
    await sonde.useTLS({ rejectUnauthorized: false, host: hostname, servername: hostname });
    return sonde.ftp.socket.getPeerCertificate(true)?.infoAccess?.['CA Issuers - URI']?.[0] ?? null;
  } finally {
    sonde.close();
  }
}

// Les maillons, du certificat présenté jusqu'à une racine connue de Node (PEM). Échoue plutôt que
// de rendre une chaîne qui n'aboutit pas.
export async function completerChaine(hostname, port, {
  sonder = sonderAia,
  lire = (url) => fetch(url, { signal: AbortSignal.timeout(15000) }),
  racines = tls.rootCertificates,
} = {}) {
  const connues = racines.map((p) => new X509Certificate(p));
  const maillons = [];
  let adresse = await sonder(hostname, port);
  for (let i = 0; adresse && i < MAILLONS_MAX; i++) {
    if (!/^https?:\/\//.test(adresse)) break;
    const res = await lire(adresse);
    if (!res?.ok) throw new Error(`maillon introuvable : ${adresse} (HTTP ${res?.status ?? '?'})`);
    let maillon;
    try {
      maillon = new X509Certificate(Buffer.from(await res.arrayBuffer()));
    } catch {
      throw new Error(`maillon illisible : ${adresse}`);
    }
    maillons.push(maillon.toString());
    if (connues.some((r) => maillon.checkIssued(r) && maillon.verify(r.publicKey))) return maillons;
    adresse = maillon.infoAccess?.match(/CA Issuers - URI:(\S+)/)?.[1] ?? null;
  }
  throw new Error(`chaîne de certificats de ${hostname} impossible à compléter jusqu'à une racine connue`);
}

async function ouvrir({ hostname, port, user, pass }) {
  const essayer = async (ca) => {
    const client = new Client(30000);
    try {
      await client.access({ host: hostname, port, user, password: pass, secure: true, ...(ca ? { secureOptions: { ca } } : {}) });
      return client;
    } catch (e) {
      client.close();
      throw e;
    }
  };
  const dejaCompletee = chainesCompletees.get(hostname);
  try {
    return await essayer(dejaCompletee);
  } catch (e) {
    if (e.code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
      throw new Error(`Certificat FTP émis pour un autre nom que ${hostname} : mettre dans SFTP_HOST le nom du serveur (ex. pasta.o2switch.net)`);
    }
    if (!CHAINE_INCOMPLETE.has(e.code) || dejaCompletee) throw e;
    const maillons = await completerChaine(hostname, port);
    const ca = [...tls.rootCertificates, ...maillons];
    chainesCompletees.set(hostname, ca);
    console.log(`   FTP : chaîne de certificats incomplète chez ${hostname}, complétée par ${maillons.length} maillon(s) officiel(s)`);
    return essayer(ca);
  }
}

// FTPS explicite (o2switch ferme SSH aux IP non autorisées, dont GitHub Actions)
// SFTP_HOST accepte « hôte » ou « hôte:port » ; SFTP_DIR « / » = racine du compte FTP
export async function uploadFiles(files, { host, user, pass, dir }) {
  const [hostname, port = '21'] = host.split(':');
  const client = await ouvrir({ hostname, port: Number(port), user, pass });
  try {
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
  // sans délai, une réponse qui ne vient jamais fige toute l'exécution
  const res = await fetch(url, { cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(20000) });
  await res.body?.cancel();
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.startsWith('image/')) {
    throw new Error(`Image non accessible publiquement (${res.status} ${type}) : ${url}`);
  }
}
