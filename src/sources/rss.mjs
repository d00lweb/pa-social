import { XMLParser } from 'fast-xml-parser';

const UA = 'pa-social/0.1 (+https://passion-aquitaine.ouest-france.fr)';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ['item', 'category', 'media:content'].includes(name),
});

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', laquo: '«', raquo: '»',
  hellip: '…', ndash: '–', mdash: '—', oelig: 'œ', OElig: 'Œ',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', agrave: 'à', acirc: 'â',
  ccedil: 'ç', icirc: 'î', iuml: 'ï', ocirc: 'ô', ucirc: 'û', ugrave: 'ù',
  Eacute: 'É', Egrave: 'È', Agrave: 'À', Ccedil: 'Ç',
};

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return NAMED[e] ?? NAMED[e.toLowerCase()] ?? m;
  });
}

// HTML -> texte propre, apostrophes typographiques
export function cleanText(html) {
  return decodeEntities(
    String(html)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t\r\n]+/g, ' ')
    .replace(/'/g, '’')
    .trim();
}

export function cleanDescription(html) {
  const paras = [...String(html).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => m[1]);
  const texts = (paras.length ? paras : [html])
    .map(cleanText)
    // paragraphe WordPress « L’article … est apparu en premier sur … »
    .map((t) => t.replace(/L’article\b[\s\S]*est apparu en premier sur[\s\S]*$/i, '').trim())
    .filter(Boolean);
  const first = texts[0] ?? '';
  // parenthèse finale courte = ajout SEO
  return first
    .replace(/\s*\(([^()]*)\)\s*([.!?…]*)$/u, (m, inner, punct) => (inner.length < 40 ? punct : m))
    .trim();
}

const text = (v) => (v == null ? '' : typeof v === 'object' ? String(v['#text'] ?? '') : String(v));

// enclosure = image pleine taille ; jamais media:content (vignette 400px)
function pickImage(item) {
  const enclosures = [item.enclosure].flat().filter(Boolean);
  const image = enclosures.find((e) => e['@_url'] && (!e['@_type'] || e['@_type'].startsWith('image/')));
  return image?.['@_url'] ?? null;
}

const fold = (s) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[’'-]/g, ' ').toLowerCase();

// Relance manuelle : retrouve un article du flux par identifiant, lien, ou mots du titre
export function matchArticle(items, term) {
  const raw = String(term ?? '').trim();
  const words = fold(raw).split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const exact = items.find((a) => a.guid === raw || a.link === raw);
  if (exact) return exact;
  return items.filter((a) => words.every((w) => fold(a.title).includes(w))).sort((a, b) => b.date - a.date)[0] ?? null;
}

// Le flux du site en panne ne doit pas bloquer ce qui est déjà en file. Le 22/10/2026, deux réponses
// « 500 » du site ont fait échouer deux passages entiers : rien de ce qui était programmé n'est parti,
// ni mesure, ni modération. Désormais : un second essai 5 s plus tard, puis le passage continue sans
// nouveaux articles. La panne est datée dans la mémoire ; l'alerte part si elle dure (3 h), une fois
// par jour, et la mémoire est nettoyée dès que le flux répond. Rend { items, ok }.
export const PANNE_ALERTE_H = 3;
export async function lireFlux(url, memory, { now = Date.now(), lire = fetchItems, attendre = (ms) => new Promise((r) => setTimeout(r, ms)), alerter = async () => {}, log = console.log } = {}) {
  let erreur;
  for (let essai = 1; essai <= 2; essai++) {
    try {
      const items = await lire(url);
      if (memory.fluxEnPanneDepuis) log('Flux RSS rétabli.');
      delete memory.fluxEnPanneDepuis;
      delete memory.fluxAlerte;
      return { items, ok: true };
    } catch (e) {
      erreur = e;
      if (essai === 1) await attendre(5000);
    }
  }
  memory.fluxEnPanneDepuis ??= now;
  const heures = (now - memory.fluxEnPanneDepuis) / 3600e3;
  log(`Flux RSS indisponible (${erreur.message}) : passage sans nouveaux articles, la file continue.`);
  const jour = new Date(now).toISOString().slice(0, 10);
  if (heures >= PANNE_ALERTE_H && memory.fluxAlerte !== jour) {
    memory.fluxAlerte = jour;
    await alerter(heures, erreur.message);
  }
  return { items: [], ok: false };
}

export async function fetchItems(url) {
  // sans délai, un site qui ne répond pas figerait tout le passage
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Flux RSS ${res.status} : ${url}`);
  const xml = parser.parse(await res.text());
  const items = xml?.rss?.channel?.item ?? [];

  return items.map((item) => {
    const pubDate = text(item.pubDate);
    return {
      title: cleanText(text(item.title)),
      link: text(item.link),
      guid: text(item.guid) || text(item.link),
      pubDate,
      date: new Date(pubDate).getTime() || 0,
      categories: (item.category ?? []).map((c) => cleanText(text(c))).filter(Boolean),
      image: pickImage(item),
      description: cleanDescription(text(item.description)),
    };
  });
}
