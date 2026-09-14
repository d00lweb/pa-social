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

export async function fetchItems(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
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
