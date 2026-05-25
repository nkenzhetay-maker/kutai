const { getStore } = require('@netlify/blobs');

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
    const store = getStore({ name: 'kutai-usage-logs', consistency: 'strong' });
    const insightStore = getStore({ name: 'kutai-insights', consistency: 'strong' });

    // GET — istatistikleri ve öğrenilen içgörüleri getir
    if (event.httpMethod === 'GET') {
      const { blobs } = await store.list();

      const logs = await Promise.all(
        blobs
          .sort((a, b) => b.key.localeCompare(a.key))
          .slice(0, 200)
          .map(async (blob) => store.get(blob.key, { type: 'json' }))
      );

      const validLogs = logs.filter(Boolean);

      // İstatistikleri hesapla
      const stats = {
        total: validLogs.length,
        byFormat: {},
        byCategory: {},
        byHour: {},
        topTopics: [],
        recentLogs: validLogs.slice(0, 20)
      };

      validLogs.forEach(log => {
        // Format sayısı
        stats.byFormat[log.format] = (stats.byFormat[log.format] || 0) + 1;
        // Kategori sayısı
        stats.byCategory[log.category] = (stats.byCategory[log.category] || 0) + 1;
        // Saat dağılımı
        const hour = new Date(log.timestamp).getHours();
        stats.byHour[hour] = (stats.byHour[hour] || 0) + 1;
      });

      // En çok kopyalanan konular
      const topicCount = {};
      validLogs.forEach(log => {
        if (log.briefPreview) {
          const words = log.briefPreview.toLowerCase().split(/\s+/).filter(w => w.length > 4);
          words.forEach(w => { topicCount[w] = (topicCount[w] || 0) + 1; });
        }
      });
      stats.topTopics = Object.entries(topicCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([word, count]) => ({ word, count }));

      // Öğrenilen içgörüleri getir
      let insights = null;
      try {
        insights = await insightStore.get('latest', { type: 'json' });
      } catch(e) { /* henüz yok */ }

      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ stats, insights })
      };
    }

    // POST — yeni kopyalama olayını kaydet
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body);
      const { action } = body;

      if (action === 'log_copy') {
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
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
      }

      if (action === 'analyze') {
        // KutAI kendi loglarını analiz eder ve öğrenir
        const { blobs } = await store.list();
        const logs = await Promise.all(
          blobs
            .sort((a, b) => b.key.localeCompare(a.key))
            .slice(0, 100)
            .map(async (blob) => store.get(blob.key, { type: 'json' }))
        );
        const validLogs = logs.filter(Boolean);

        if (validLogs.length < 5) {
          return {
            statusCode: 200,
            headers: CORS,
            body: JSON.stringify({ insight: null, message: 'Недостаточно данных для анализа. Нужно минимум 5 копирований.' })
          };
        }

        // Logları özetleyelim ve Claude'a analiz ettirelim
        const summary = validLogs.slice(0, 50).map((l, i) =>
          `${i+1}. [${l.format}] [${l.category}] "${l.headlinePreview || l.briefPreview || '—'}" (${new Date(l.timestamp).toLocaleDateString('ru-RU')})`
        ).join('\n');

        const analyzePrompt = `Ты — аналитик редакционных данных TRT Russian.
        
Вот список материалов, которые редакторы скопировали и использовали (значит — одобрили):
${summary}

Проанализируй эти данные и выдели:
1. Какие ФОРМАТЫ работают лучше всего?
2. Какие КАТЕГОРИИ востребованы больше?
3. Какие ТЕМЫ и паттерны в заголовках повторяются?
4. В какое ВРЕМЯ дня чаще всего создают контент?
5. Дай 3-5 конкретных РЕКОМЕНДАЦИИ для улучшения будущих материалов.

Ответ должен быть кратким, конкретным, на русском языке. Без воды.`;

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
            messages: [{ role: 'user', content: analyzePrompt }]
          })
        });

        const data = await response.json();
        const insightText = data.content[0]?.text || '';

        const insightEntry = {
          text: insightText,
          generatedAt: new Date().toISOString(),
          basedOnCount: validLogs.length
        };

        await insightStore.setJSON('latest', insightEntry);

        return {
          statusCode: 200,
          headers: CORS,
          body: JSON.stringify({ insight: insightEntry })
        };
      }

      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Unknown action' }) };
    }

    return { statusCode: 405, headers: CORS, body: 'Method not allowed' };

  } catch (err) {
    console.error('KutAI log error:', err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message })
    };
  }
};
