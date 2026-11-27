# Pagtago sa Gemini API key (Cloudflare Pages)

Ang key wala na sa website. Naa na kini sa server sa Cloudflare.

1. I-upload sa GitHub ang tanang files niining folder, apil ang `functions/api/gemini.js`.
   (Ang folder `functions` kinahanglan naa sa **root** sa repo, tapad sa `index.html`.)
2. Sa Cloudflare: **Workers & Pages → (imong project) → Settings → Variables and Secrets → Add**
   - Type: **Secret**
   - Variable name: `GEMINI_API_KEY`
   - Value: ang imong Gemini API key
   - I-save.
3. **Deployments → (pinakabag-o) → ⋯ → Retry deployment** (o mag-push og bag-ong commit) aron mabasa sa server ang bag-ong secret.
4. Sulayi ang **✨ Dugang Kasayoran** sa Kaabag ug ang Sermon.

Mga timaan:
- Tungod kay naay publikong `/api/gemini`, ang tawo makagamit gihapon sa imong quota. Sa Google AI Studio, ibutang ang quota/spending limit sa key.
- Kung kaniadto naka-expose na ang key (naa sa code sa GitHub), **himoa ang bag-ong key** ug i-delete ang daan.
