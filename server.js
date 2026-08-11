require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const MINT_PIN = process.env.MINT_PIN;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const AI_MODEL = process.env.AI_MODEL || 'gemini-3.1-flash-lite-preview';

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '25mb' }));

// ── AUTH ──
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!MINT_PIN || token !== MINT_PIN) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ── GEMINI AI ──
async function callAI(messages, maxTokens = 500) {
  // Convert OpenAI-style messages to Gemini format
  const contents = [];
  let systemInstruction = null;

  for (const m of messages) {
    if (m.role === 'system') {
      systemInstruction = { parts: [{ text: m.content }] };
      continue;
    }
    // content can be string or array (vision)
    if (typeof m.content === 'string') {
      contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
    } else {
      // vision: array of {type, text} or {type, image_url}
      const parts = m.content.map(c => {
        if (c.type === 'text') return { text: c.text };
        if (c.type === 'image_url') {
          const url = c.image_url.url;
          const match = url.match(/^data:(.+);base64,(.+)$/);
          if (match) return { inline_data: { mime_type: match[1], data: match[2] } };
        }
        return null;
      }).filter(Boolean);
      contents.push({ role: 'user', parts });
    }
  }

  const body = { contents, generationConfig: { maxOutputTokens: maxTokens } };
  if (systemInstruction) body.systemInstruction = systemInstruction;

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent?key=${GEMINI_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

// ── DB INIT ──
async function initDB() {
  // Create all tables with full correct schema
  await pool.query(`
    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY DEFAULT 1,
      data JSONB NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS food_logs (
      id TEXT PRIMARY KEY,
      client_id TEXT,
      food_name TEXT,
      raw_input TEXT,
      logged_at TIMESTAMPTZ,
      iris_note TEXT,
      ayur_note TEXT,
      source TEXT,
      category TEXT,
      nutrition_line TEXT,
      calories_est REAL,
      protein_est REAL,
      carbs_est REAL,
      fiber_est REAL,
      sodium_est REAL,
      added_sugar_est REAL,
      magnesium_est REAL,
      vitamind_est REAL,
      b12_est REAL,
      iron_est REAL,
      potassium_est REAL,
      caffeine_est REAL,
      pre_meal JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS morning_reports (
      id SERIAL PRIMARY KEY,
      client_id TEXT,
      logged_at TIMESTAMPTZ,
      report_date DATE,
      bristol_type INTEGER,
      urine_color_idx INTEGER,
      urine_label TEXT,
      gas_level INTEGER,
      burp_level INTEGER,
      iris_analysis TEXT,
      time_label TEXT,
      output_type TEXT,
      stool_color TEXT,
      frequency INTEGER,
      extra_params TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS patterns (
      id SERIAL PRIMARY KEY,
      food_name TEXT UNIQUE NOT NULL,
      symptom TEXT,
      elapsed_min INTEGER,
      elapsed_times JSONB DEFAULT '[]',
      avg_elapsed_min INTEGER,
      episode_count INTEGER DEFAULT 1,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS water_logs (
      id SERIAL PRIMARY KEY,
      client_id TEXT,
      logged_at TIMESTAMPTZ,
      amount_oz REAL,
      beverage_type TEXT,
      caffeine_est REAL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS prefood (
      id SERIAL PRIMARY KEY,
      client_id TEXT,
      logged_at TIMESTAMPTZ,
      hunger INTEGER,
      mood TEXT,
      craving TEXT,
      food_log_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS postfood (
      id SERIAL PRIMARY KEY,
      client_id TEXT,
      food_log_id TEXT,
      logged_at TIMESTAMPTZ,
      symptoms TEXT,
      elapsed_minutes INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS companion (
      id SERIAL PRIMARY KEY,
      client_id TEXT,
      logged_at TIMESTAMPTZ,
      raw_input TEXT,
      entry_type TEXT,
      filed_as TEXT,
      iris_note TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id SERIAL PRIMARY KEY,
      feedback TEXT,
      version TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // ALTER TABLE: patch any existing tables that are missing columns
  const migrations = [
    // food_logs
    `ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS client_id TEXT`,
    `ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS category TEXT`,
    `ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS ayur_note TEXT`,
    `ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS iris_note TEXT`,
    `ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS source TEXT`,
    `ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS nutrition_line TEXT`,
    `ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS pre_meal JSONB`,
    `ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS calories_est REAL`,
    `ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS protein_est REAL`,
    `ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS carbs_est REAL`,
    `ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS fiber_est REAL`,
    `ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS sodium_est REAL`,
    `ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS added_sugar_est REAL`,
    `ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS magnesium_est REAL`,
    `ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS vitamind_est REAL`,
    `ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS b12_est REAL`,
    `ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS iron_est REAL`,
    `ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS potassium_est REAL`,
    `ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS caffeine_est REAL`,
    // morning_reports
    `ALTER TABLE morning_reports ADD COLUMN IF NOT EXISTS client_id TEXT`,
    `ALTER TABLE morning_reports ADD COLUMN IF NOT EXISTS report_date DATE`,
    `ALTER TABLE morning_reports ADD COLUMN IF NOT EXISTS bristol_type INTEGER`,
    `ALTER TABLE morning_reports ADD COLUMN IF NOT EXISTS urine_color_idx INTEGER`,
    `ALTER TABLE morning_reports ADD COLUMN IF NOT EXISTS urine_label TEXT`,
    `ALTER TABLE morning_reports ADD COLUMN IF NOT EXISTS gas_level INTEGER`,
    `ALTER TABLE morning_reports ADD COLUMN IF NOT EXISTS burp_level INTEGER`,
    `ALTER TABLE morning_reports ADD COLUMN IF NOT EXISTS iris_analysis TEXT`,
    `ALTER TABLE morning_reports ADD COLUMN IF NOT EXISTS time_label TEXT`,
    `ALTER TABLE morning_reports ADD COLUMN IF NOT EXISTS output_type TEXT`,
    `ALTER TABLE morning_reports ADD COLUMN IF NOT EXISTS stool_color TEXT`,
    `ALTER TABLE morning_reports ADD COLUMN IF NOT EXISTS frequency INTEGER`,
    `ALTER TABLE morning_reports ADD COLUMN IF NOT EXISTS extra_params TEXT`,
    // water_logs — fix old column names (old schema had amount, unit, extra)
    `ALTER TABLE water_logs ADD COLUMN IF NOT EXISTS amount_oz REAL`,
    `ALTER TABLE water_logs ADD COLUMN IF NOT EXISTS beverage_type TEXT`,
    `ALTER TABLE water_logs ADD COLUMN IF NOT EXISTS caffeine_est REAL`,
  ];

  for (const sql of migrations) {
    try { await pool.query(sql); } catch (_) {}
  }

  console.log('DB tables ready');
}

// ══════════════════════════════
// ROUTES
// ══════════════════════════════

// POST /api/auth
app.post('/api/auth', (req, res) => {
  const { pin } = req.body || {};
  res.json({ ok: pin === MINT_PIN });
});

// GET /api/profile
app.get('/api/profile', auth, async (req, res) => {
  try {
    const r = await pool.query('SELECT data FROM profile WHERE id = 1');
    res.json({ profile: r.rows[0]?.data || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/profile
app.post('/api/profile', auth, async (req, res) => {
  try {
    await pool.query(
      'INSERT INTO profile (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = $1',
      [JSON.stringify(req.body)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/food?days=90
app.get('/api/food', auth, async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 90, 1), 730);
    const r = await pool.query(
      `SELECT * FROM food_logs WHERE logged_at >= NOW() - INTERVAL '1 day' * $1 ORDER BY logged_at ASC`,
      [days]
    );
    res.json({ logs: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/food
app.post('/api/food', auth, async (req, res) => {
  try {
    const b = req.body;
    const id = b.client_id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
    await pool.query(
      `INSERT INTO food_logs
        (id, client_id, food_name, raw_input, logged_at, iris_note, ayur_note, source, category,
         nutrition_line, calories_est, protein_est, carbs_est, fiber_est, sodium_est, added_sugar_est,
         magnesium_est, vitamind_est, b12_est, iron_est, potassium_est, caffeine_est, pre_meal)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       ON CONFLICT (id) DO NOTHING`,
      [
        id, b.client_id, b.food_name, b.raw_input, b.logged_at,
        b.iris_note, b.ayur_note, b.source, b.category || null,
        b.nutrition_line, b.calories_est, b.protein_est, b.carbs_est, b.fiber_est,
        b.sodium_est, b.added_sugar_est, b.magnesium_est, b.vitamind_est,
        b.b12_est, b.iron_est, b.potassium_est, b.caffeine_est,
        b.pre_meal ? JSON.stringify(b.pre_meal) : null
      ]
    );
    res.json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/morning
app.get('/api/morning', auth, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM morning_reports ORDER BY logged_at ASC');
    res.json({ reports: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/morning
app.post('/api/morning', auth, async (req, res) => {
  try {
    const b = req.body;
    const r = await pool.query(
      `INSERT INTO morning_reports
        (client_id, logged_at, report_date, bristol_type, urine_color_idx, urine_label,
         gas_level, burp_level, iris_analysis, time_label, output_type, stool_color, frequency, extra_params)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [
        b.client_id, b.logged_at, b.report_date, b.bristol_type,
        b.urine_color_idx, b.urine_label, b.gas_level, b.burp_level,
        b.iris_analysis, b.time_label, b.output_type,
        b.stool_color, b.frequency, b.extra_params
      ]
    );
    res.json({ id: r.rows[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/patterns
app.get('/api/patterns', auth, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM patterns ORDER BY episode_count DESC');
    res.json({ patterns: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/patterns
app.post('/api/patterns', auth, async (req, res) => {
  try {
    const b = req.body;
    await pool.query(
      `INSERT INTO patterns (food_name, symptom, elapsed_min, elapsed_times, avg_elapsed_min, episode_count)
       VALUES ($1,$2,$3,$4,$5,1)
       ON CONFLICT (food_name) DO UPDATE SET
         symptom=$2, elapsed_min=$3, elapsed_times=$4, avg_elapsed_min=$5,
         episode_count=patterns.episode_count+1, updated_at=NOW()`,
      [b.food_name, b.symptom, b.elapsed_min, JSON.stringify(b.elapsed_times || []), b.avg_elapsed_min]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/pantry — derived from food_logs so it's always in sync
app.get('/api/pantry', auth, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        LOWER(SPLIT_PART(food_name, ',', 1)) AS food_name,
        COUNT(*)::integer AS log_count,
        MAX(logged_at) AS last_logged_at
      FROM food_logs
      WHERE food_name IS NOT NULL AND food_name != ''
      GROUP BY LOWER(SPLIT_PART(food_name, ',', 1))
      ORDER BY log_count DESC, last_logged_at DESC
      LIMIT 150
    `);
    res.json({ pantry: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pantry — accepted but pantry is derived from food_logs, so this is a no-op
app.post('/api/pantry', auth, (req, res) => res.json({ ok: true }));

// GET /api/water?days=1
app.get('/api/water', auth, async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 1, 1), 30);
    const r = await pool.query(
      `SELECT * FROM water_logs WHERE logged_at >= NOW() - INTERVAL '1 day' * $1 ORDER BY logged_at ASC`,
      [days]
    );
    res.json({ logs: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/water  — HTML sends: amount_oz, beverage_type, caffeine_est
app.post('/api/water', auth, async (req, res) => {
  try {
    const b = req.body;
    const r = await pool.query(
      `INSERT INTO water_logs (client_id, logged_at, amount_oz, beverage_type, caffeine_est)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [b.client_id, b.logged_at, b.amount_oz, b.beverage_type, b.caffeine_est]
    );
    res.json({ id: r.rows[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/prefood
app.post('/api/prefood', auth, async (req, res) => {
  try {
    const b = req.body;
    await pool.query(
      `INSERT INTO prefood (client_id, logged_at, hunger, mood, craving, food_log_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [b.client_id, b.logged_at, b.hunger, b.mood, b.craving, b.food_log_id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/postfood
app.post('/api/postfood', auth, async (req, res) => {
  try {
    const b = req.body;
    await pool.query(
      `INSERT INTO postfood (client_id, food_log_id, logged_at, symptoms, elapsed_minutes)
       VALUES ($1,$2,$3,$4,$5)`,
      [b.client_id, b.food_log_id, b.logged_at, b.symptoms, b.elapsed_minutes]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/companion
app.post('/api/companion', auth, async (req, res) => {
  try {
    const b = req.body;
    await pool.query(
      `INSERT INTO companion (client_id, logged_at, raw_input, entry_type, filed_as, iris_note)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [b.client_id, b.logged_at, b.raw_input, b.entry_type, b.filed_as, b.iris_note]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/feedback
app.post('/api/feedback', auth, async (req, res) => {
  try {
    const b = req.body;
    await pool.query(
      `INSERT INTO feedback (feedback, version) VALUES ($1,$2)`,
      [b.feedback, b.version]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/sync — full data export
app.get('/api/sync', auth, async (req, res) => {
  try {
    const [prof, food, morning, patterns, water] = await Promise.all([
      pool.query('SELECT data FROM profile WHERE id=1'),
      pool.query('SELECT * FROM food_logs ORDER BY logged_at ASC'),
      pool.query('SELECT * FROM morning_reports ORDER BY logged_at ASC'),
      pool.query('SELECT * FROM patterns ORDER BY episode_count DESC'),
      pool.query('SELECT * FROM water_logs ORDER BY logged_at ASC'),
    ]);
    res.json({
      profile: prof.rows[0]?.data || null,
      food_logs: food.rows,
      morning_reports: morning.rows,
      patterns: patterns.rows,
      water_logs: water.rows,
      exported_at: new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/iris
app.post('/api/iris', auth, async (req, res) => {
  try {
    const { prompt, maxTokens, systemPrompt } = req.body;
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });
    const text = await callAI(messages, maxTokens || 500);
    res.json({ text });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/photo
app.post('/api/photo', auth, async (req, res) => {
  try {
    const { images, groupDescription } = req.body;
    const content = [
      ...images.map(img => ({
        type: 'image_url',
        image_url: { url: `data:${img.mediaType};base64,${img.data}` }
      })),
      { type: 'text', text: groupDescription || 'Describe this food. Estimate calories, protein, carbs, fiber.' }
    ];
    const description = await callAI([{ role: 'user', content }], 800);
    res.json({ description });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Health check
app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ── START ──
const PORT = process.env.PORT || 3000;
initDB()
  .then(() => app.listen(PORT, () => console.log(`MINT backend on port ${PORT}`)))
  .catch(err => { console.error('DB init failed:', err); process.exit(1); });
