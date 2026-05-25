const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

// Simple log storage using Netlify's built-in environment
// Logs stored in a simple append approach via fetch to a self-hosted endpoint
// For now: use a simple array stored as environment variable approach
// Best practice: use external KV store or just accumulate per-request

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  // Use Netlify Blobs if available, otherwise graceful fallback
  let store = null;
  try {
    const blobs = require('@netlify/blobs');
    store = blobs.getStore({ name: 'kutai-usage-logs', consistency: 'strong' });
  } catch(e) {
    // @netlify/blobs not available in build environment
  }

  try {
    if (event.httpMethod === 'GET') {
      if (!store) {
        return {
          statusCode: 200,
          headers: CORS,
          body: JSON.stringify({ stats: { total: 0, byFormat: {}, byCategory: {}, byHour: {}, recentLogs: [] }, insights: null })
        };
      }

      const { blobs } = await store.list();
      const logs = await Promise.all(
        blobs
          .sort((a, b) => b.key.localeCompare(a.key))
          .slice(0, 200)
          .map(async (blob) => {
            try { return await store.get(blob.key, { type: 'json' }); }
            catch(e) { return null; }
          })
      );
      const validLogs = logs.filter(Boolean);

      const stats = {
        total: validLogs.length,
        byFormat: {},
        byCategory: {},
        byHour: {},
        recentLogs: validLogs.slice(0, 20)
      };

      validLogs.forEach(log => {
        if (log.format) stats.byFormat[log.format] = (stats.byFormat[log.format] || 0) + 1;
        if (log.category) stats.byCategory[log.category] = (stats.byCategory[log.category] || 0) + 1;
        const hour = new Date(log.timestamp).getHours();
        stats.byHour[hour] = (stats.byHour[hour] || 0) + 1;
      });

      let insights = null;
      try {
        insights = await store.get('latest_insight', { type: 'json' });
      } catch(e) {}

      return { statusCode: 200, headers: CORS, body: JSON.stringify({ stats, insights }) };
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { action } = body;

      if (action === 'log_copy') {
        if (store) {
          const key = 'copy_' + Date.now();
          await store.setJSON(key, {
            timestamp: Date.now(),
            date: new Date().toISOString(),
            format: body.format || 'unknown',
            category: body.category || 'unknown',
            panel: body.panel || 'unknown',
            briefPreview: (body.briefPreview || '').slice(0, 80),
            headlinePreview: (body.headlinePreview || '').slice(0, 100)
          });
        }
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
      }

      if (action === 'analyze') {
        if (!store) {
          return { statusCode: 200, headers: CORS, body: JSON.stringify({ message: 'Хранилище недоступно.' }) };
        }

        const { blobs } = await store.list();
        const logs = await Promise.all(
          blobs
            .filter(b => b.key.startsWith('copy_'))
            .sort((a, b) => b.key.localeCompare(a.key))
            .slice(0, 100)
            .map(async (blob) => {
              try { return await store.get(blob.key, { type: 'json' }); }
              catch(e) { return null; }
            })
        );
        const validLogs = logs.filter(Boolean);

        if (validLogs.length < 5) {
          return { statusCode: 200, headers: CORS, body: JSON.stringify({ message: 'Нужно минимум 5 копирований.' }) };
        }

        const summary = validLogs.slice(0, 50).map((l, i) =>
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
            messages: [{ role: 'user', content: 'Ты — аналитик редакционных данных TRT Russian. Вот список скопированных материалов:\n' + summary + '\n\nДай краткий анализ: какие форматы/категории/темы популярнее, когда активнее работают, и 3-5 рекомендаций.' }]
          })
        });

        const data = await response.json();
        const insightText = data.content[0]?.text || '';
        const insightEntry = { text: insightText, generatedAt: new Date().toISOString(), basedOnCount: validLogs.length };
        await store.setJSON('latest_insight', insightEntry);

        return { statusCode: 200, headers: CORS, body: JSON.stringify({ insight: insightEntry }) };
      }

      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Unknown action' }) };
    }

    return { statusCode: 405, headers: CORS, body: 'Method not allowed' };

  } catch (err) {
    console.error('KutAI log error:', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
