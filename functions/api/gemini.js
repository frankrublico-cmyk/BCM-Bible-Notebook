// Cloudflare Pages Function: tagoan sa server ang API keys.
// 1) Unang gisulayan ang Google Gemini.
// 2) Kung mapakyas (quota 429, location 400, 5xx, o wala'y key), awtomatiko nga moliso sa:
//    a) Cloudflare Workers AI (binding nga ngalan: AI)  -- libre kada adlaw, walay location problem
//    b) Opsyonal: laing serbisyo nga OpenAI-compatible (Groq, OpenRouter, ug uban)
//       env: FALLBACK2_URL, FALLBACK2_KEY, FALLBACK2_MODEL
// Ang tubag gibalik sa samang porma sa Gemini, busa wala'y usbon sa index.html.
//
// Opsyonal nga env: GEMINI_GATEWAY_URL, CF_AIG_TOKEN, FALLBACK_MODEL

const J = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const err = (status, message) =>
  new Response(JSON.stringify({ error: { message: status + ' ' + message } }), { status, headers: J });

// Himoon nga SSE sa porma nga masabtan sa index.html
function sseResponse(text) {
  const chunk = { candidates: [{ content: { role: 'model', parts: [{ text }] } }] };
  return new Response('data: ' + JSON.stringify(chunk) + '\n\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' },
  });
}

function toMessages(contents) {
  const msgs = [{
    role: 'system',
    content: 'Reply with ONLY valid JSON exactly in the shape requested. No markdown, no code fences, no extra text.',
  }];
  for (const c of contents) {
    const text = (c.parts || []).map((p) => (p && p.text) || '').join('');
    if (text) msgs.push({ role: c.role === 'model' ? 'assistant' : 'user', content: text });
  }
  return msgs;
}

function pickText(res) {
  if (!res) return '';
  if (typeof res === 'string') return res;
  if (typeof res.response === 'string') return res.response;
  if (res.response && typeof res.response === 'object') return JSON.stringify(res.response);
  if (res.choices && res.choices[0]) {
    const m = res.choices[0].message || {};
    return String(m.content || res.choices[0].text || '');
  }
  if (typeof res.result === 'string') return res.result;
  return '';
}

async function viaWorkersAI(env, messages, maxTokens, temperature) {
  if (!env.AI) throw new Error('Wala pa gibutang ang Workers AI binding (AI).');
  const model = (env.FALLBACK_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast').trim();
  const res = await env.AI.run(model, { messages, max_tokens: maxTokens, temperature });
  const text = pickText(res).trim();
  if (!text) throw new Error('Walay sulod ang tubag sa Workers AI.');
  return text;
}

async function viaOpenAICompat(env, messages, maxTokens, temperature) {
  const base = (env.FALLBACK2_URL || '').trim().replace(/\/+$/, '');
  const k = (env.FALLBACK2_KEY || '').trim();
  const model = (env.FALLBACK2_MODEL || '').trim();
  if (!base || !k || !model) throw new Error('Wala gi-set ang FALLBACK2.');
  const r = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + k },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
  });
  if (!r.ok) throw new Error('FALLBACK2 ' + r.status);
  const text = pickText(await r.json()).trim();
  if (!text) throw new Error('Walay sulod ang tubag sa FALLBACK2.');
  return text;
}

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

  const model = url.searchParams.get('m') || '';
  const type = url.searchParams.get('t') === 'vtx' ? 'vtx' : 'dev';
  if (!/^[A-Za-z0-9._-]{3,60}$/.test(model)) return err(400, 'Sayop nga model.');

  const raw = await request.text();
  if (raw.length > 80000) return err(413, 'Dako kaayo ang gipadala.');
  let data;
  try { data = JSON.parse(raw); } catch (_) { return err(400, 'Sayop nga data.'); }
  if (!data || !Array.isArray(data.contents)) return err(400, 'Sayop nga data.');

  const gc = data.generationConfig || {};
  const temperature = typeof gc.temperature === 'number' ? gc.temperature : 0.3;
  const maxTokens = Math.min(Number(gc.maxOutputTokens) || 8000, 16000);
  const payload = {
    contents: data.contents,
    generationConfig: { temperature, maxOutputTokens: maxTokens, responseMimeType: 'application/json' },
  };

  // ---- 1) Google Gemini ----
  let geminiFail = 'Wala gibutang ang GEMINI_API_KEY.';
  if (key && !(type === 'vtx' && !key.startsWith('AQ.'))) {
    const headers = { 'Content-Type': 'application/json' };
    let target;
    if (type === 'vtx') {
      target = 'https://aiplatform.googleapis.com/v1/publishers/google/models/' + model +
        ':streamGenerateContent?alt=sse&key=' + encodeURIComponent(key);
    } else {
      const gw = (env.GEMINI_GATEWAY_URL ? String(env.GEMINI_GATEWAY_URL) : '').trim().replace(/\/+$/, '');
      const base = gw || 'https://generativelanguage.googleapis.com';
      target = base + '/v1beta/models/' + model + ':streamGenerateContent?alt=sse';
      headers['x-goog-api-key'] = key;
      if (env.CF_AIG_TOKEN) headers['cf-aig-authorization'] = 'Bearer ' + String(env.CF_AIG_TOKEN).trim();
    }
    try {
      const r = await fetch(target, { method: 'POST', headers, body: JSON.stringify(payload) });
      if (r.ok) {
        return new Response(r.body, {
          status: 200,
          headers: {
            'Content-Type': r.headers.get('content-type') || 'text/event-stream',
            'Cache-Control': 'no-store',
          },
        });
      }
      geminiFail = 'Gemini ' + r.status;
      // 404 = sayop nga model: ipasa ang sayop aron masulayan sa app ang lain nga model
      if (r.status === 404) return new Response(r.body, { status: 404, headers: J });
    } catch (e) {
      geminiFail = 'Wala maabot ang Google.';
    }
  }

  // ---- 2) Backup: Cloudflare Workers AI, dayon opsyonal nga ika-2 nga serbisyo ----
  const messages = toMessages(data.contents);
  const fails = [geminiFail];
  try {
    return sseResponse(await viaWorkersAI(env, messages, maxTokens, temperature));
  } catch (e) { fails.push('Workers AI: ' + (e && e.message ? e.message : e)); }
  try {
    return sseResponse(await viaOpenAICompat(env, messages, maxTokens, temperature));
  } catch (e) { fails.push(String(e && e.message ? e.message : e)); }

  return err(429, 'Napakyas ang tanang serbisyo. ' + fails.join(' | '));
}
