// Recipe link import — a Cloudflare Worker for Food Manager.
//
// A web page is not allowed to read other websites directly, so the app asks this Worker to
// do it:  GET https://<your-worker>.workers.dev/?url=<recipe page address>
// The Worker downloads the page, finds the recipe data most recipe sites embed for search
// engines (schema.org "Recipe" in JSON-LD), and returns only those fields as JSON. It never
// returns the page itself, so it cannot be used as a general-purpose proxy.

// Websites allowed to call this Worker from a browser. Change this if the app's address changes.
const ALLOWED_ORIGINS = ['https://mhumphries72.github.io'];

const MAX_BYTES = 3_000_000;

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
    const cors = {
      'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Vary': 'Origin',
    };
    const reply = (status, body) => new Response(JSON.stringify(body), {
      status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return reply(405, { error: 'method' });
    if (origin && !allowed) return reply(403, { error: 'origin' });

    let target;
    try { target = new URL(new URL(request.url).searchParams.get('url')); } catch (e) { return reply(400, { error: 'bad-url' }); }
    const host = target.hostname;
    if (!/^https?:$/.test(target.protocol) || host === 'localhost' || !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':')) {
      return reply(400, { error: 'bad-url' });
    }

    let html;
    try {
      const res = await fetch(target.href, {
        redirect: 'follow',
        signal: AbortSignal.timeout(10000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; FoodManagerRecipeImport/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en',
        },
      });
      if (!res.ok) return reply(502, { error: 'fetch-failed', status: res.status });
      html = (await res.text()).slice(0, MAX_BYTES);
    } catch (e) {
      return reply(502, { error: 'fetch-failed' });
    }

    const recipe = extractRecipe(html, target.href);
    return recipe ? reply(200, recipe) : reply(422, { error: 'no-recipe' });
  },
};

// ---- parsing ----

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', frac12: '½', frac14: '¼', frac34: '¾', deg: '°', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

function decode(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z0-9]+);/gi, (m, code) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? m;
    const n = /^#x/i.test(code) ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
  });
}

// Plain single-line text: no tags, entities decoded (twice, since sites often double-encode).
function text(value) {
  if (value == null) return '';
  return decode(decode(String(value).replace(/<[^>]*>/g, ' '))).replace(/\s+/g, ' ').trim();
}

function isRecipe(node) {
  const t = node && node['@type'];
  return Array.isArray(t) ? t.includes('Recipe') : t === 'Recipe';
}

function findRecipe(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const item of node) { const found = findRecipe(item, depth + 1); if (found) return found; }
    return null;
  }
  if (isRecipe(node)) return node;
  return findRecipe(node['@graph'], depth + 1) || findRecipe(node.mainEntity, depth + 1) || findRecipe(node.mainEntityOfPage, depth + 1);
}

function stepList(value) {
  if (!value) return [];
  if (typeof value === 'string') {
    return value.replace(/<\/(p|li|div)>|<br\s*\/?>/gi, '\n').split(/\n+/).map(text).filter(Boolean);
  }
  if (Array.isArray(value)) return value.flatMap(stepList);
  if (typeof value === 'object') {
    if (value.itemListElement) {
      const heading = text(value.name);
      return [...(heading ? [`${heading}:`] : []), ...stepList(value.itemListElement)];
    }
    return stepList(value.text || value.name);
  }
  return [];
}

function servings(value) {
  for (const v of Array.isArray(value) ? value : [value]) {
    const m = String(v ?? '').match(/\d+/);
    if (m && Number(m[0]) > 0 && Number(m[0]) < 100) return Number(m[0]);
  }
  return null;
}

export function extractRecipe(html, pageUrl) {
  const blocks = html.matchAll(/<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi);
  for (const [, raw] of blocks) {
    let data;
    try { data = JSON.parse(raw); }
    catch (e) {
      try { data = JSON.parse(raw.replace(/[\u0000-\u001f]+/g, ' ')); } catch (e2) { continue; }
    }
    const r = findRecipe(data);
    if (!r) continue;
    const ingredients = [].concat(r.recipeIngredient || r.ingredients || []).map(text).filter(Boolean);
    const name = text(r.name);
    if (!name && !ingredients.length) continue;
    return {
      name,
      servings: servings(r.recipeYield),
      ingredients,
      steps: stepList(r.recipeInstructions),
      source: pageUrl,
    };
  }
  return null;
}
