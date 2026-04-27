export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });

  const { type, urls, prompt, useSearch } = req.body;

  try {
    // ── 복수 URL 페칭 ──────────────────────────────────
    if (type === 'urls' && Array.isArray(urls) && urls.length > 0) {
      const results = await Promise.allSettled(urls.map(url => fetchPage(url)));
      const pages = results.map((r, i) => ({
        url: urls[i],
        ok: r.status === 'fulfilled',
        text: r.status === 'fulfilled' ? r.value.text : null,
        images: r.status === 'fulfilled' ? r.value.images : [],
        error: r.status === 'rejected' ? r.reason?.message : null,
      }));
      return res.status(200).json({ pages });
    }

    // ── Claude API 호출 ────────────────────────────────
    if (prompt) {
      const result = await callClaude(ANTHROPIC_KEY, prompt, useSearch);
      return res.status(200).json({ result });
    }

    return res.status(400).json({ error: '요청 형식이 올바르지 않습니다.' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ── URL 페이지 가져오기 ────────────────────────────────
async function fetchPage(url) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,*/*',
      'Accept-Language': 'ko,en;q=0.9',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const html = await r.text();

  // 이미지 추출
  const images = [];
  const imgRe = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = imgRe.exec(html)) !== null) {
    const src = m[1];
    if (src && !src.startsWith('data:')) {
      const absUrl = src.startsWith('http') ? src : new URL(src, url).href;
      if (!absUrl.match(/icon|logo|pixel|tracking|1x1|blank|sprite/i) &&
          absUrl.match(/\.(jpg|jpeg|png|webp|gif)/i)) {
        images.push(absUrl);
      }
    }
    if (images.length >= 8) break;
  }

  // 텍스트 추출 (구조 보존)
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<h[1-6][^>]*>/gi, '\n\n## ')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s{3,}/g, '\n\n')
    .trim()
    .slice(0, 10000);

  return { text, images };
}

// ── Claude API 호출 ────────────────────────────────────
async function callClaude(key, prompt, useSearch) {
  const body = {
    model: 'claude-opus-4-5',
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }],
  };
  if (useSearch) body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || `HTTP ${r.status}`); }
  const d = await r.json();
  // 텍스트 블록만 합치기
  return d.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
}
