// KutAI Usage Log — localStorage tabanlı basit log
// @netlify/blobs gerektirmez, Netlify'da sorunsuz çalışır

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  try {
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');

      // log_copy — sadece 200 döndür, frontend localStorage'da saklar
      if (body.action === 'log_copy') {
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
      }

      // analyze — Claude ile log analizi
      if (body.action === 'analyze') {
        const logs = body.logs || [];
        if (logs.length < 5) {
          return {
            statusCode: 200,
            headers: CORS,
            body: JSON.stringify({ message: 'Нужно минимум 5 копирований для анализа.' })
          };
        }

        const summary = logs.slice(0, 50).map((l, i) =>
          (i+1) + '. [' + (l.format||'?') + '] [' + (l.category||'?') + '] "' + (l.headlinePreview||l.briefPreview||'—') + '"'
        ).join('\n');

        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 800,
            messages: [{
              role: 'user',
              content: 'Ты — аналитик редакции TRT Russian. Вот список скопированных материалов:\n' + summary
                + '\n\nДай краткий анализ: какие форматы/категории популярнее, когда активнее работают, и 3-5 конкретных рекомендаций.'
            }]
          })
        });

        const data = await response.json();
        const insightText = data.content?.[0]?.text || '';

        return {
          statusCode: 200,
          headers: CORS,
          body: JSON.stringify({
            insight: {
              text: insightText,
              generatedAt: new Date().toISOString(),
              basedOnCount: logs.length
            }
          })
        };
      }

      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Unknown action' }) };
    }

    return { statusCode: 405, headers: CORS, body: 'Method not allowed' };

  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
