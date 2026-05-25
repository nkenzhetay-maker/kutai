const SOURCES = [
  {
    name: 'TRT World',
    id: 'trt',
    // Google News RSS for TRT World articles
    url: 'https://news.google.com/rss/search?q=site:trtworld.com&hl=en-US&gl=US&ceid=US:en'
  },
  {
    name: 'AA',
    id: 'aa',
    url: 'https://www.aa.com.tr/en/rss/default?cat=world'
  },
  {
    name: 'Reuters',
    id: 'reuters',
    // Google News RSS for Reuters - official feed was discontinued
    url: 'https://news.google.com/rss/search?q=when:24h+allinurl:reuters.com+world&hl=en-US&gl=US&ceid=US:en'
  },
  {
    name: 'Al Jazeera',
    id: 'aljazeera',
    url: 'https://www.aljazeera.com/xml/rss/all.xml'
  }
];

const PRIORITY_KEYWORDS = [
  'explosion', 'blast', 'earthquake', 'tsunami', 'flood', 'hurricane',
  'attack', 'strike', 'killed', 'dead', 'war declared', 'ceasefire',
  'terror', 'missile', 'airstrike', 'breaking'
];

const RELEVANT_KEYWORDS = [
  'gaza', 'palestine', 'israel', 'hamas', 'west bank', 'lebanon',
  'ukraine', 'russia', 'zelensky', 'putin', 'kyiv',
  'erdogan', 'turkey', 'turkish', 'fidan', 'ankara',
  'trump', 'usa', 'middle east', 'gulf', 'iran',
  'syria', 'iraq', 'afghanistan', 'pakistan',
  'africa', 'france',
  'muslim', 'islam', 'islamophobia',
  'turkic', 'azerbaijan', 'kazakhstan', 'uzbekistan',
  'nato', 'un', 'united nations', 'ceasefire', 'peace talks'
];

function parseRSS(xml, source) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    
    const title = extractTag(item, 'title') || '';
    const description = extractTag(item, 'description') || '';
    const link = extractTag(item, 'link') || '';
    const pubDate = extractTag(item, 'pubDate') || '';
    const category = extractTag(item, 'category') || '';
    
    const text = (title + ' ' + description + ' ' + category).toLowerCase();
    
    const isRelevant = RELEVANT_KEYWORDS.some(kw => text.includes(kw));
    if (!isRelevant) continue;
    
    const isUrgent = PRIORITY_KEYWORDS.some(kw => text.includes(kw));
    
    // Reuters & Al Jazeera: filter strictly — only our priority topics
    if (source.id === 'reuters' || source.id === 'aljazeera') {
      const strictTopics = ['gaza', 'ukraine', 'erdogan', 'turkey', 'turkish', 'trump', 'iran', 'israel', 'russia', 'hamas', 'palestine', 'middle east', 'arab'];
      const isStrictMatch = strictTopics.some(kw => text.includes(kw));
      if (!isStrictMatch) continue;
    }
    
    items.push({
      id: Buffer.from(title).toString('base64').slice(0, 12),
      source: source.name,
      sourceId: source.id,
      title: cleanText(title),
      description: cleanText(description).slice(0, 200),
      link: cleanText(link),
      pubDate: pubDate,
      timestamp: pubDate ? new Date(pubDate).getTime() : Date.now(),
      isUrgent,
      preparedRu: null
    });
  }
  
  return items;
}

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'))
    || xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? match[1].trim() : null;
}

function cleanText(str) {
  return str
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  try {
    const allItems = [];

    await Promise.allSettled(
      SOURCES.map(async (source) => {
        try {
          const res = await fetch(source.url, {
            headers: { 'User-Agent': 'TRT-Russian-News-Bot/1.0' },
            signal: AbortSignal.timeout(8000)
          });
          if (!res.ok) return;
          const xml = await res.text();
          const items = parseRSS(xml, source);
          allItems.push(...items);
        } catch (e) {
          console.error(`Error fetching ${source.name}:`, e.message);
        }
      })
    );

    // Sort: urgent first, then by date
    allItems.sort((a, b) => {
      if (a.isUrgent && !b.isUrgent) return -1;
      if (!a.isUrgent && b.isUrgent) return 1;
      return b.timestamp - a.timestamp;
    });

    // Deduplicate by similar titles
    const seen = new Set();
    const unique = allItems.filter(item => {
      const key = item.title.slice(0, 40).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        items: unique.slice(0, 30),
        fetchedAt: new Date().toISOString(),
        sources: SOURCES.map(s => s.name)
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message })
    };
  }
};
