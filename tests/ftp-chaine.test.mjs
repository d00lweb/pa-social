import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { completerChaine } from '../src/storage/ftp.mjs';

// 23/10/2026 : le serveur FTPS d'o2switch ne présentait plus ses certificats intermédiaires, et Node
// refusait la connexion (« unable to verify the first certificate ») : plus aucune image déposée.
// Les deux maillons ci-dessous sont les vrais, téléchargés aux adresses que donne le certificat
// du serveur. Aucun réseau n'est touché ici : la sonde et les téléchargements sont simulés.
const YR1 = readFileSync(new URL('./fixtures/lets-encrypt-yr1.pem', import.meta.url), 'utf8');
const ROOT_YR = readFileSync(new URL('./fixtures/lets-encrypt-root-yr-par-isrg-x1.pem', import.meta.url), 'utf8');
const der = (pem) => new X509Certificate(pem).raw;
const servi = (corps, status = 200) => ({ ok: status === 200, status, arrayBuffer: async () => corps });

test('chaîne incomplète : complétée maillon par maillon jusqu’à une racine connue de Node', async () => {
  const adresses = [];
  const lire = async (url) => {
    adresses.push(url);
    return servi({ 'http://yr1.i.lencr.org/': der(YR1), 'http://yr.i.lencr.org/': der(ROOT_YR) }[url]);
  };
  const maillons = await completerChaine('pasta.o2switch.net', 21, { sonder: async () => 'http://yr1.i.lencr.org/', lire });
  assert.deepEqual(adresses, ['http://yr1.i.lencr.org/', 'http://yr.i.lencr.org/'], 'l’adresse du maillon suivant est lue sur le précédent');
  assert.equal(maillons.length, 2);
  assert.match(new X509Certificate(maillons[1]).issuer, /ISRG Root X1/, 'le dernier est signé par une racine que Node connaît');
});

test('une chaîne qui n’aboutit pas est refusée, jamais rendue à moitié', async () => {
  // sans ISRG Root X1 parmi les racines, le chemin ne mène nulle part
  const connus = { 'http://yr1.i.lencr.org/': der(YR1), 'http://yr.i.lencr.org/': der(ROOT_YR) };
  const lire = async (url) => (connus[url] ? servi(connus[url]) : servi(null, 404));
  await assert.rejects(
    completerChaine('pasta.o2switch.net', 21, { sonder: async () => 'http://yr1.i.lencr.org/', lire, racines: [] }),
    /impossible à compléter|maillon introuvable/,
  );
  // maillon introuvable, maillon illisible, ou certificat sans adresse d'émetteur : refus net
  await assert.rejects(completerChaine('h', 21, { sonder: async () => 'http://x/', lire: async () => servi(null, 404) }), /maillon introuvable/);
  await assert.rejects(completerChaine('h', 21, { sonder: async () => 'http://x/', lire: async () => servi(new ArrayBuffer(8)) }), /maillon illisible/);
  await assert.rejects(completerChaine('h', 21, { sonder: async () => null, lire }), /impossible à compléter/);
});
