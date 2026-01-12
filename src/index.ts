import { Hono } from 'hono';

const FILTERS = {
  urgency: ['high', 'medium', 'low'],
  theme: ['product', 'support', 'pricing', 'ux', 'performance', 'security'],
  value: ['revenue', 'retention', 'adoption', 'efficiency'],
  sentiment: ['positive', 'neutral', 'negative']
} as const;

type FilterKey = keyof typeof FILTERS;

type FeedbackRow = {
  id: number;
  user_name: string;
  channel: string;
  urgency: string;
  theme: string;
  value: string;
  sentiment: string;
  message: string;
  created_at: string;
};

type Env = {
  FEEDBACK_DB: D1Database;
  SUMMARY_CACHE: KVNamespace;
  AI: Ai;
};

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) => c.redirect('/dashboard'));

app.get('/dashboard', (c) => c.html(renderDashboard()));

app.get('/feedback', (c) => c.html(renderFeedbackForm()));

app.get('/api/feedback', async (c) => {
  const query = c.req.query();
  const filters = {
    urgency: sanitizeFilter('urgency', query.urgency),
    theme: sanitizeFilter('theme', query.theme),
    value: sanitizeFilter('value', query.value),
    sentiment: sanitizeFilter('sentiment', query.sentiment)
  };
  const limit = Math.min(Math.max(Number(query.limit) || 5, 1), 25);
  const { sql, params } = buildFeedbackQuery(filters, limit);
  const results = await c.env.FEEDBACK_DB.prepare(sql).bind(...params).all<FeedbackRow>();
  return c.json({ data: results.results || [] });
});

app.post('/api/feedback', async (c) => {
  const body = await c.req.parseBody();
  const userName = String(body.user_name || 'Anonymous').slice(0, 80);
  const channel = String(body.channel || 'Web').slice(0, 40);
  const message = String(body.message || '').trim();
  const urgency = sanitizeFilter('urgency', String(body.urgency || 'medium'));
  const theme = sanitizeFilter('theme', String(body.theme || 'product'));
  const value = sanitizeFilter('value', String(body.value || 'retention'));
  const sentiment = sanitizeFilter('sentiment', String(body.sentiment || 'neutral'));

  if (!message) {
    return c.json({ error: 'Message is required.' }, 400);
  }

  await c.env.FEEDBACK_DB
    .prepare(
      'INSERT INTO feedback (user_name, channel, urgency, theme, value, sentiment, message) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(userName, channel, urgency, theme, value, sentiment, message)
    .run();

  return c.json({ ok: true });
});

app.get('/api/ai-summary', async (c) => {
  const cached = await c.env.SUMMARY_CACHE.get('summary:latest', 'json');
  if (cached) {
    return c.json(cached);
  }

  const summary = await runSummaryWorkflow(c.env);
  await c.env.SUMMARY_CACHE.put('summary:latest', JSON.stringify(summary), { expirationTtl: 3600 });
  return c.json(summary);
});

app.get('/api/workflow/run', async (c) => {
  const summary = await runSummaryWorkflow(c.env);
  await c.env.SUMMARY_CACHE.put('summary:latest', JSON.stringify(summary), { expirationTtl: 3600 });
  return c.json({ status: 'completed', summary });
});

function sanitizeFilter(key: FilterKey, value?: string | null) {
  const normalized = (value || '').toLowerCase();
  return FILTERS[key].includes(normalized as (typeof FILTERS)[FilterKey][number])
    ? normalized
    : FILTERS[key][0];
}

function buildFeedbackQuery(
  filters: Record<FilterKey, string>,
  limit: number
): { sql: string; params: Array<string | number> } {
  const whereClauses: string[] = [];
  const params: Array<string | number> = [];

  (Object.keys(filters) as FilterKey[]).forEach((key) => {
    if (filters[key]) {
      whereClauses.push(`${key} = ?`);
      params.push(filters[key]);
    }
  });

  let sql =
    'SELECT id, user_name, channel, urgency, theme, value, sentiment, message, created_at FROM feedback';
  if (whereClauses.length) {
    sql += ` WHERE ${whereClauses.join(' AND ')}`;
  }
  sql += ' ORDER BY datetime(created_at) DESC LIMIT ?';
  params.push(limit);

  return { sql, params };
}

async function runSummaryWorkflow(env: Env) {
  const feedback = await env.FEEDBACK_DB.prepare(
    'SELECT user_name, urgency, theme, value, sentiment, message FROM feedback ORDER BY datetime(created_at) DESC LIMIT 50'
  ).all<FeedbackRow>();

  const records = feedback.results || [];
  const fallback = {
    summary:
      'Feedback highlights center on performance bottlenecks, missing analytics fields, and compliance requirements. Positive signals point to onboarding, templates, and pricing discounts improving adoption.',
    recommendations: [
      'Prioritize performance fixes for dashboard load times and real-time metrics to protect revenue workflows.',
      'Expand analytics exports and attribution data to support sales and marketing teams.',
      'Ship security compliance items (SSO audit logs, retention policies) to reduce renewal risk.'
    ],
    updated_at: new Date().toISOString()
  };

  if (!records.length) {
    return fallback;
  }

  const prompt = `You are an AI insights assistant. Summarize key findings and propose 3-5 concrete solutions.
Return JSON with fields: summary (string), recommendations (array of strings).
Feedback:
${records
    .map(
      (item) =>
        `- (${item.urgency}/${item.theme}/${item.value}/${item.sentiment}) ${item.message}`
    )
    .join('\n')}`;

  try {
    const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: 'You return concise JSON only.' },
        { role: 'user', content: prompt }
      ]
    });

    const parsed = typeof aiResponse === 'string' ? JSON.parse(aiResponse) : aiResponse;
    return {
      summary: parsed.summary || fallback.summary,
      recommendations: parsed.recommendations || fallback.recommendations,
      updated_at: new Date().toISOString()
    };
  } catch (error) {
    return {
      ...fallback,
      updated_at: new Date().toISOString(),
      error: (error as Error).message
    };
  }
}

function renderDashboard() {
  const defaultFilters = {
    urgency: FILTERS.urgency[0],
    theme: FILTERS.theme[0],
    value: FILTERS.value[0],
    sentiment: FILTERS.sentiment[2]
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Feedback Intelligence Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      font-family: "Inter", system-ui, -apple-system, sans-serif;
      background: #f6f7fb;
      color: #1f2937;
    }
    body {
      margin: 0;
      padding: 32px;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }
    .tag {
      background: #e0e7ff;
      color: #3730a3;
      padding: 6px 12px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
    }
    .grid {
      display: grid;
      gap: 20px;
    }
    .grid.two {
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 20px;
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
    }
    .card h3 {
      margin-top: 0;
    }
    .filter-row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    select {
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 8px 10px;
      font-size: 14px;
    }
    ul {
      padding-left: 18px;
    }
    li {
      margin-bottom: 10px;
    }
    .feedback-meta {
      font-size: 12px;
      color: #6b7280;
    }
    button {
      border: none;
      border-radius: 10px;
      background: #111827;
      color: white;
      padding: 10px 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .ai-box {
      background: #fef3c7;
      border-radius: 14px;
      padding: 16px;
      margin-top: 12px;
    }
    .link {
      color: #4f46e5;
      text-decoration: none;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Feedback Intelligence Dashboard</h1>
      <p>Monitor urgency, themes, value impact, and sentiment with AI-supported insights.</p>
    </div>
    <div class="tag">Cloudflare Workers Prototype</div>
  </header>

  <div class="grid two">
    <div class="card">
      <h3>Filter highlights (top 5 each)</h3>
      <div class="filter-row">
        <label>
          Urgency
          <select id="urgency-filter">
            ${FILTERS.urgency
              .map((item) => `<option value="${item}">${item}</option>`)
              .join('')}
          </select>
        </label>
        <label>
          Theme
          <select id="theme-filter">
            ${FILTERS.theme
              .map((item) => `<option value="${item}">${item}</option>`)
              .join('')}
          </select>
        </label>
        <label>
          Value
          <select id="value-filter">
            ${FILTERS.value
              .map((item) => `<option value="${item}">${item}</option>`)
              .join('')}
          </select>
        </label>
        <label>
          Sentiment
          <select id="sentiment-filter">
            ${FILTERS.sentiment
              .map((item) => `<option value="${item}">${item}</option>`)
              .join('')}
          </select>
        </label>
      </div>
      <div class="grid two" style="margin-top: 16px;">
        <div>
          <h4>Urgency focus</h4>
          <ul id="urgency-list"></ul>
        </div>
        <div>
          <h4>Theme focus</h4>
          <ul id="theme-list"></ul>
        </div>
        <div>
          <h4>Value focus</h4>
          <ul id="value-list"></ul>
        </div>
        <div>
          <h4>Sentiment focus</h4>
          <ul id="sentiment-list"></ul>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>AI Insights Bot</h3>
      <p>Summarizes the top findings and suggests solutions based on the latest feedback.</p>
      <button id="run-ai">Generate AI Summary</button>
      <div id="ai-output" class="ai-box" style="display: none;"></div>
      <p style="margin-top: 16px;">Need more feedback? <a class="link" href="/feedback">Collect user feedback</a>.</p>
    </div>
  </div>

  <div class="card" style="margin-top: 20px;">
    <h3>Combined filter results (top 5)</h3>
    <p>Uses all four filters together for quick validation before weekly reviews.</p>
    <ul id="combined-list"></ul>
  </div>

  <script>
    const defaultFilters = ${JSON.stringify(defaultFilters)};

    function buildList(items) {
      if (!items.length) {
        return '<li>No feedback found for this filter.</li>';
      }
      return items
        .map(
          (item) => `
            <li>
              <div>${item.message}</div>
              <div class="feedback-meta">${item.user_name} · ${item.channel} · ${item.urgency}/${item.theme}/${item.value}/${item.sentiment}</div>
            </li>
          `
        )
        .join('');
    }

    async function loadFocusList(listId, params) {
      const query = new URLSearchParams({ ...params, limit: '5' });
      const response = await fetch(`/api/feedback?${query.toString()}`);
      const data = await response.json();
      document.getElementById(listId).innerHTML = buildList(data.data || []);
    }

    async function refreshAll() {
      const urgency = document.getElementById('urgency-filter').value;
      const theme = document.getElementById('theme-filter').value;
      const value = document.getElementById('value-filter').value;
      const sentiment = document.getElementById('sentiment-filter').value;

      await Promise.all([
        loadFocusList('urgency-list', { urgency }),
        loadFocusList('theme-list', { theme }),
        loadFocusList('value-list', { value }),
        loadFocusList('sentiment-list', { sentiment }),
        loadFocusList('combined-list', { urgency, theme, value, sentiment })
      ]);
    }

    document.getElementById('urgency-filter').value = defaultFilters.urgency;
    document.getElementById('theme-filter').value = defaultFilters.theme;
    document.getElementById('value-filter').value = defaultFilters.value;
    document.getElementById('sentiment-filter').value = defaultFilters.sentiment;

    document.getElementById('run-ai').addEventListener('click', async () => {
      const output = document.getElementById('ai-output');
      output.style.display = 'block';
      output.textContent = 'Summarizing feedback...';
      const response = await fetch('/api/ai-summary');
      const data = await response.json();
      output.innerHTML = `
        <strong>Key Findings</strong>
        <p>${data.summary}</p>
        <strong>Suggested Solutions</strong>
        <ul>${(data.recommendations || []).map((item) => `<li>${item}</li>`).join('')}</ul>
        <div class="feedback-meta">Updated ${new Date(data.updated_at).toLocaleString()}</div>
      `;
    });

    ['urgency-filter', 'theme-filter', 'value-filter', 'sentiment-filter'].forEach((id) => {
      document.getElementById(id).addEventListener('change', refreshAll);
    });

    refreshAll();
  </script>
</body>
</html>`;
}

function renderFeedbackForm() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Submit Feedback</title>
  <style>
    :root {
      font-family: "Inter", system-ui, -apple-system, sans-serif;
      background: #f8fafc;
      color: #0f172a;
    }
    body {
      margin: 0;
      padding: 32px;
      display: flex;
      justify-content: center;
    }
    form {
      background: white;
      padding: 24px;
      border-radius: 18px;
      width: min(640px, 100%);
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.1);
    }
    label {
      display: block;
      font-weight: 600;
      margin-bottom: 6px;
    }
    input, select, textarea {
      width: 100%;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid #e2e8f0;
      margin-bottom: 16px;
      font-size: 14px;
    }
    button {
      background: #111827;
      color: white;
      border: none;
      border-radius: 10px;
      padding: 12px 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .notice {
      margin-top: 16px;
      color: #475569;
    }
    .link {
      color: #4f46e5;
      font-weight: 600;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <form id="feedback-form">
    <h1>Collect User Feedback</h1>
    <p>Share insights with the dashboard. Responses flow into the AI summary workflow.</p>

    <label for="user_name">Name</label>
    <input id="user_name" name="user_name" placeholder="Alex Morgan" />

    <label for="channel">Channel</label>
    <input id="channel" name="channel" placeholder="In-app, Email, Survey" />

    <label for="urgency">Urgency</label>
    <select id="urgency" name="urgency">
      ${FILTERS.urgency.map((item) => `<option value="${item}">${item}</option>`).join('')}
    </select>

    <label for="theme">Theme</label>
    <select id="theme" name="theme">
      ${FILTERS.theme.map((item) => `<option value="${item}">${item}</option>`).join('')}
    </select>

    <label for="value">Value impact</label>
    <select id="value" name="value">
      ${FILTERS.value.map((item) => `<option value="${item}">${item}</option>`).join('')}
    </select>

    <label for="sentiment">Sentiment</label>
    <select id="sentiment" name="sentiment">
      ${FILTERS.sentiment.map((item) => `<option value="${item}">${item}</option>`).join('')}
    </select>

    <label for="message">Feedback</label>
    <textarea id="message" name="message" rows="5" placeholder="Tell us what is working and what needs attention."></textarea>

    <button type="submit">Submit feedback</button>
    <p class="notice">Looking to review insights? <a class="link" href="/dashboard">Return to dashboard</a>.</p>
  </form>

  <script>
    document.getElementById('feedback-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const formData = new FormData(form);
      const response = await fetch('/api/feedback', {
        method: 'POST',
        body: formData
      });
      if (response.ok) {
        form.reset();
        alert('Feedback submitted successfully.');
      } else {
        alert('Unable to submit feedback.');
      }
    });
  </script>
</body>
</html>`;
}

export default app;
