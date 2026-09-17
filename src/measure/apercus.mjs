import { uploadFiles, assertPublic } from '../storage/ftp.mjs';

// Aperçu de ce qui a réellement été publié, réseau par réseau : le texte exact et le visuel exact.
// Déposé APRÈS la publication et dans un filet : un aperçu ne doit jamais faire rater un post.
const DEFAULT_PUBLIC = 'https://passion-aquitaine.ouest-france.fr/social';

const texteDe = (pkg, channel) => {
  if (channel === 'instagram') return pkg.caption ?? '';
  if (channel === 'facebook') return pkg.text ?? '';
  return pkg.text ?? '';
};

// Les visuels d'Instagram, Facebook et Threads sont déjà en ligne (ils sont publiés par leur URL).
// Ceux de Bluesky et du kit X ne le sont pas : on les dépose ici pour que la page puisse les montrer.
const dejaEnLigne = new Set(['instagram', 'facebook', 'threads']);

export async function capturer(pkg, channel, { log = console.log } = {}) {
  const base = (process.env.PUBLIC_BASE_URL || DEFAULT_PUBLIC).replace(/\/+$/, '');
  const fichier = pkg.files?.[0];
  let image = null;

  if (fichier) {
    image = `${base}/${fichier.name}`;
    if (!dejaEnLigne.has(channel)) {
      try {
        await uploadFiles([fichier], {
          host: process.env.SFTP_HOST,
          user: process.env.SFTP_USER,
          pass: process.env.SFTP_PASS,
          dir: process.env.SFTP_DIR,
        });
        await assertPublic(image);
      } catch (e) {
        log(`   Aperçu ${channel} non déposé : ${e.message}`);
        image = null;
      }
    }
  }

  return {
    texte: texteDe(pkg, channel),
    image,
    mode: pkg.mode ?? null,
    reponse: pkg.replyText ?? pkg.comment ?? null,
    sujet: pkg.sujet ?? null,
  };
}
