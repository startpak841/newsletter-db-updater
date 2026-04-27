export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });

  const { type, text, url, prompt, useSearch } = req.body;

  try {
    let content = text || '';

    // URL 페칭
    if (type === 'url' && url) {
      try {
        const pageRes = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; KOMICS-Bot/1.0)',
            'Accept': 'text/html,application/xhtml+xml,text/plain',
          },
          signal: AbortSignal.timeout(15000),
        });
        if (!pageRes.ok) throw new Error(`페이지 응답 오류: ${pageRes.status}`);
        const html = await pageRes.text();
        // HTML 태그 제거, 텍스트만 추출
        content = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\s{3,}/g, '\n\n')
          .trim()
          .slice(0, 8000);
      } catch (e) {
        return res.status(400).json({ error: `URL 페칭 실패: ${e.message}` });
      }
    }

    if (!content && !prompt) return res.status(400).json({ error: '분석할 내용이 없습니다.' });

    // Anthropic API 호출
    const body = {
      model: 'claude-opus-4-5',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt || content }],
    };
    if (useSearch) {
      body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
    }

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!apiRes.ok) {
      const err = await apiRes.json();
      return res.status(apiRes.status).json({ error: err.error?.message || 'API 오류' });
    }

    const data = await apiRes.json();
    const resultText = data.content.filter(c => c.type === 'text').map(c => c.text).join('\n');

    return res.status(200).json({ result: resultText, fetchedContent: type === 'url' ? content : null });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
