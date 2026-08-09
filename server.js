require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();

// ── DB ──
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const MINT_PIN = process.env.MINT_PIN;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const AI_MODEL = process.env.AI_MODEL || 'google/gemini-3.1-flash-lite-preview';

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '25mb' }));

// ── AUTH MIDDLEWARE ──
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!MINT_PIN || token !== MINT_PIN) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ── OPENROUTER HELPER ──
async function callAI(messages, maxTokens = 500) {
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://mint-app.local',
      'X-Title': 'MINT by DK'
    },
    body: JSON.stringify({ model: AI_MODEL, max_tokens: maxTokens, messages })
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenRouter error ${resp.status}: ${err}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || null;
}

// ── STARTUP: CREATE TABLES ──
async function initDB() {
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
    CREATE TABLE IF NOT EXISTS pantry (
      id SERIAL PRIMARY KEY,
      food_name TEXT UNIQUE NOT NULL,
      log_count INTEGER DEFAULT 1,
      last_logged_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS water_logs (
      id SERIAL PRIMARY KEY,
      client_id TEXT,
      logged_at TIMESTAMPTZ,
      amount REAL,
      unit TEXT,
      extra JSONB,
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
  `);
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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/profile
app.post('/api/profile', auth, async (req, res) => {
  try {
    await pool.query(
      'INSERT INTO profile (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = $1',
      [JSON.stringify(req.body)]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/food
app.post('/api/food', auth, async (req, res) => {
  try {
    const b = req.body;
    const id = b.client_id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
    await pool.query(
      `INSERT INTO food_logs
        (id, client_id, food_name, raw_input, logged_at, iris_note, ayur_note, source, nutrition_line,
         calories_est, protein_est, carbs_est, fiber_est, sodium_est, added_sugar_est,
         magnesium_est, vitamind_est, b12_est, iron_est, potassium_est, caffeine_est, pre_meal)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       ON CONFLICT (id) DO NOTHING`,
      [
        id, b.client_id, b.food_name, b.raw_input, b.logged_at,
        b.iris_note, b.ayur_note, b.source, b.nutrition_line,
        b.calories_est, b.protein_est, b.carbs_est, b.fiber_est, b.sodium_est, b.added_sugar_est,
        b.magnesium_est, b.vitamind_est, b.b12_est, b.iron_est, b.potassium_est, b.caffeine_est,
        b.pre_meal ? JSON.stringify(b.pre_meal) : null
      ]
    );
    res.json({ id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/morning
app.get('/api/morning', auth, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM morning_reports ORDER BY logged_at ASC');
    res.json({ reports: r.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
        b.client_id, b.logged_at, b.report_date, b.bristol_type, b.urine_color_idx, b.urine_label,
        b.gas_level, b.burp_level, b.iris_analysis, b.time_label, b.output_type,
        b.stool_color, b.frequency, b.extra_params
      ]
    );
    res.json({ id: r.rows[0].id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/patterns
app.get('/api/patterns', auth, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM patterns ORDER BY episode_count DESC');
    res.json({ patterns: r.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/patterns
app.post('/api/patterns', auth, async (req, res) => {
  try {
    const b = req.body;
    await pool.query(
      `INSERT INTO patterns (food_name, symptom, elapsed_min, elapsed_times, avg_elapsed_min, episode_count)
       VALUES ($1, $2, $3, $4, $5, 1)
       ON CONFLICT (food_name) DO UPDATE SET
         symptom = $2, elapsed_min = $3, elapsed_times = $4, avg_elapsed_min = $5,
         episode_count = patterns.episode_count + 1, updated_at = NOW()`,
      [b.food_name, b.symptom, b.elapsed_min, JSON.stringify(b.elapsed_times || []), b.avg_elapsed_min]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/pantry
app.get('/api/pantry', auth, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM pantry ORDER BY log_count DESC, last_logged_at DESC');
    res.json({ pantry: r.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/pantry
app.post('/api/pantry', auth, async (req, res) => {
  try {
    const b = req.body;
    await pool.query(
      `INSERT INTO pantry (food_name, log_count, last_logged_at) VALUES ($1, 1, $2)
       ON CONFLICT (food_name) DO UPDATE SET
         log_count = pantry.log_count + 1, last_logged_at = $2`,
      [b.food_name, b.last_logged_at || new Date().toISOString()]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/water?days=1
app.get('/api/water', auth, async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 1, 1), 30);
    const r = await pool.query(
      `SELECT * FROM water_logs WHERE logged_at >= NOW() - INTERVAL '1 day' * $1 ORDER BY logged_at ASC`,
      [days]
    );
    res.json({ logs: r.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/water
app.post('/api/water', auth, async (req, res) => {
  try {
    const b = req.body;
    const r = await pool.query(
      `INSERT INTO water_logs (client_id, logged_at, amount, unit, extra)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [b.client_id, b.logged_at, b.amount, b.unit, b.extra ? JSON.stringify(b.extra) : null]
    );
    res.json({ id: r.rows[0].id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/prefood
app.post('/api/prefood', auth, async (req, res) => {
  try {
    const b = req.body;
    await pool.query(
      `INSERT INTO prefood (client_id, logged_at, hunger, mood, craving, food_log_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [b.client_id, b.logged_at, b.hunger, b.mood, b.craving, b.food_log_id]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/iris  — text AI via OpenRouter
app.post('/api/iris', auth, async (req, res) => {
  try {
    const { prompt, maxTokens, systemPrompt } = req.body;
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });
    const text = await callAI(messages, maxTokens || 500);
    res.json({ text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/photo  — vision AI via OpenRouter
app.post('/api/photo', auth, async (req, res) => {
  try {
    const { images, groupDescription } = req.body;
    const content = [
      ...images.map(img => ({
        type: 'image_url',
        image_url: { url: `data:${img.mediaType};base64,${img.data}` }
      })),
      {
        type: 'text',
        text: groupDescription || 'Describe this food in detail. Estimate calories, protein, carbs, fiber.'
      }
    ];
    const description = await callAI([{ role: 'user', content }], 800);
    res.json({ description });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Health check
app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ── START ──
const PORT = process.env.PORT || 3000;
initDB()
  .then(() => app.listen(PORT, () => console.log(`MINT backend on port ${PORT}`)))
  .catch(err => { console.error('DB init failed:', err); process.exit(1); });
