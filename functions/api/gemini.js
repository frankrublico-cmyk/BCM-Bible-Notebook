// Cloudflare Pages Function: tagoan sa server ang Gemini API key.
// Ang key naa ra sa Cloudflare (Variables and Secrets: GEMINI_API_KEY) — dili makita sa website.
// Gitawag kini sa index.html pinaagi sa  /api/gemini?t=dev|vtx&m=<model>

const J = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const err = (status, message) =>
  new Response(JSON.stringify({ error: { message: status + ' ' + message } }), { status, headers: J });

export async function onRequest({ request, env }) {
  const url = new URL(request.url);

  if (request.method !== 'POST') return err(405, 'POST lang ang gitugotan.');

  // Gikan ra sa atong kaugalingong website
  const origin = request.headers.get('origin');
  if (origin) {
    let ok = false;
    try { ok = new URL(origin).host === url.host; } catch (_) {}
    if (!ok) return err(403, 'Dili gitugotan ang website nga nagtawag.');
  }

  const key = (env && env.GEMINI_API_KEY ? String(env.GEMINI_API_KEY) : '').trim();
  if (!key) return err(500, 'Wala pa gibutang ang GEMINI_API_KEY sa Cloudflare.');

  const model = url.searchParams.get('m') || '';
  const type = url.searchParams.get('t') === 'vtx' ? 'vtx' : 'dev';
  if (!/^[A-Za-z0-9._-]{3,60}$/.test(model)) return err(400, 'Sayop nga model.');

  const raw = await request.text();
  if (raw.length > 80000) return err(413, 'Dako kaayo ang gipadala.');
  let data;
  try { data = JSON.parse(raw); } catch (_) { return err(400, 'Sayop nga data.'); }
  if (!data || !Array.isArray(data.contents)) return err(400, 'Sayop nga data.');

  // Gikopya lang ang gikinahanglan; gilimitahan ang gidak-on sa tubag
  const gc = data.generationConfig || {};
  const payload = {
    contents: data.contents,
    generationConfig: {
      temperature: typeof gc.temperature === 'number' ? gc.temperature : 0.3,
      maxOutputTokens: Math.min(Number(gc.maxOutputTokens) || 8000, 16000),
      responseMimeType: 'application/json',
    },
  };

  let target;
  const headers = { 'Content-Type': 'application/json' };
  if (type === 'vtx') {
    if (!key.startsWith('AQ.')) return err(400, 'Dili Vertex ang key.');
    target = 'https://aiplatform.googleapis.com/v1/publishers/google/models/' + model +
      ':streamGenerateContent?alt=sse&key=' + encodeURIComponent(key);
  } else {
    target = 'https://generativelanguage.googleapis.com/v1beta/models/' + model +
      ':streamGenerateContent?alt=sse';
    headers['x-goog-api-key'] = key;
  }

  let r;
  try {
    r = await fetch(target, { method: 'POST', headers, body: JSON.stringify(payload) });
  } catch (e) {
    return err(502, 'Wala maabot ang serbisyo sa Google.');
  }

  // Ipasa ang tubag (stream) balik sa browser
  return new Response(r.body, {
    status: r.status,
    headers: {
      'Content-Type': r.headers.get('content-type') || 'text/event-stream',
      'Cache-Control': 'no-store',
    },
  });
}
