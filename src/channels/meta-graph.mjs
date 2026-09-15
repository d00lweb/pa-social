const DEFAULT_VERSION = 'v23.0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class GraphError extends Error {
  constructor(error, status) {
    const code = [`code ${error.code ?? '?'}`];
    if (error.error_subcode) code.push(`sous-code ${error.error_subcode}`);
    const detail = [error.message, error.error_user_title, error.error_user_msg].filter(Boolean).join(' — ');
    super(`Meta HTTP ${status} · ${code.join(' · ')} : ${detail}${error.fbtrace_id ? ` (fbtrace ${error.fbtrace_id})` : ''}`);
    this.name = 'GraphError';
    this.code = error.code;
    this.subcode = error.error_subcode;
  }
}

export function createGraph({ userId, token, version }) {
  // jeton « IG… » = connexion Instagram, sinon connexion Facebook
  const host = token.startsWith('IG') ? 'graph.instagram.com' : 'graph.facebook.com';
  const base = `https://${host}/${version || DEFAULT_VERSION}`;

  async function call(method, path, params = {}) {
    const url = new URL(`${base}/${path}`);
    const body = new URLSearchParams({ ...params, access_token: token });
    const res = method === 'GET'
      ? await fetch(`${url}?${body}`)
      : await fetch(url, { method, body });
    const raw = await res.text();
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new Error(`Meta HTTP ${res.status} : réponse illisible ${raw.slice(0, 200)}`);
    }
    if (!res.ok || json.error) throw new GraphError(json.error ?? { message: raw }, res.status);
    return json;
  }

  return {
    account: () => call('GET', userId, { fields: 'username,name' }),

    async publishingLimit() {
      const { data } = await call('GET', `${userId}/content_publishing_limit`, { fields: 'quota_usage,config' });
      return { usage: data?.[0]?.quota_usage ?? 0, total: data?.[0]?.config?.quota_total ?? null };
    },

    async createImage(imageUrl, { carouselItem = false, caption } = {}) {
      const params = { image_url: imageUrl };
      if (carouselItem) params.is_carousel_item = 'true';
      if (caption) params.caption = caption;
      const { id } = await call('POST', `${userId}/media`, params);
      return id;
    },

    async createCarousel(children, caption) {
      const { id } = await call('POST', `${userId}/media`, {
        media_type: 'CAROUSEL',
        children: children.join(','),
        caption,
      });
      return id;
    },

    // Meta télécharge l'image pendant cette attente
    async waitFinished(id, { interval = 2000, tries = 30 } = {}) {
      for (let i = 1; i <= tries; i++) {
        const { status_code: code, status } = await call('GET', id, { fields: 'status_code,status' });
        if (code === 'FINISHED') return;
        if (code === 'ERROR' || code === 'EXPIRED') throw new Error(`Conteneur ${id} : ${code} (${status ?? 'sans détail'})`);
        await sleep(interval);
      }
      throw new Error(`Conteneur ${id} : pas FINISHED après ${tries} essais`);
    },

    async publish(creationId) {
      const { id } = await call('POST', `${userId}/media_publish`, { creation_id: creationId });
      return id;
    },
  };
}
