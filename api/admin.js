// api/admin.js
// Login + dashboard summary.

const { signToken, requireAuth, TOKEN_TTL_MS } = require('./_lib/auth');
const { supabase } = require('./_lib/supabase');
const { verifyPassword } = require('./_lib/passwords');

const FULL_PERMISSIONS = {
  products: { view: true, edit: true, delete: true },
  pages: { view: true, edit: true, delete: true },
  orders: { view: true, edit: true },
  traffic: { view: true },
  admins: { view: true, edit: true, delete: true },
};

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// Logs every login attempt — success AND failure. adminId is null when the
// attempt failed before we could match a real admin (bad username or wrong
// password). Returns the new row's id so the frontend can later attach GPS
// coordinates to this specific login (only happens on success).
async function logLogin(adminId, attemptedUsername, success, req) {
  try {
    const { data, error } = await supabase
      .from('admin_logins')
      .insert({
        admin_id: adminId,
        attempted_username: attemptedUsername || null,
        success,
        ip_address: getClientIp(req),
        user_agent: req.headers['user-agent'] || 'unknown',
      })
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  } catch (err) {
    console.error('logLogin failed:', err.message);
    return null;
  }
}

async function sendTelegramAlert(admin, req, faceStatus) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;

    const ip = getClientIp(req);
    const userAgent = req.headers['user-agent'] || 'unknown';
    const time = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    const faceLine = faceStatus === 'mismatch'
      ? '\n⚠️ FACE MISMATCH'
      : faceStatus === 'verified'
      ? '\n✅ Face verified'
      : '';

    const message =
      `🔐 Ryzen Admin Login\n` +
      `User: ${admin.username} (${admin.role})\n` +
      `IP: ${ip}\n` +
      `Device: ${userAgent}\n` +
      `Time: ${time}${faceLine}`;

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message }),
    });
  } catch (err) {
    console.error('sendTelegramAlert failed:', err.message);
  }
}

async function sendFailedLoginAlert(attemptedUsername, req) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;

    const ip = getClientIp(req);
    const userAgent = req.headers['user-agent'] || 'unknown';
    const time = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    const message =
      `🚫 Failed Ryzen Admin Login\n` +
      `Attempted username: ${attemptedUsername || 'unknown'}\n` +
      `IP: ${ip}\n` +
      `Device: ${userAgent}\n` +
      `Time: ${time}`;

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message }),
    });
  } catch (err) {
    console.error('sendFailedLoginAlert failed:', err.message);
  }
}

async function handleLogin(req, res) {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const { data: admin, error } = await supabase
    .from('admins')
    .select('*')
    .eq('username', username)
    .maybeSingle();

  if (error) throw error;

  if (!admin || !verifyPassword(password, admin.password_hash)) {
    // Log the failed attempt before responding — this is what feeds
    // Monitor Agent's brute-force detection.
    await logLogin(admin ? admin.id : null, username, false, req);
    await sendFailedLoginAlert(username, req);
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }

  if (admin.deactivated_at) {
    return res.status(401).json({ error: 'This account has been deactivated.' });
  }

  const loginLogId = await logLogin(admin.id, admin.username, true, req);
  await sendTelegramAlert(admin, req);

  const token = signToken({
    sub: admin.id,
    role: admin.role,
    username: admin.username,
    permissions: admin.role === 'super_admin' ? FULL_PERMISSIONS : (admin.permissions || {}),
    exp: Date.now() + TOKEN_TTL_MS,
  });

  return res.status(200).json({
    token,
    expiresInMs: TOKEN_TTL_MS,
    role: admin.role,
    mustChangePassword: !!admin.must_change_password,
    // The frontend uses this to optionally attach exact GPS coordinates
    // to this login via action=update-location, if the admin grants
    // browser location permission.
    loginLogId,
  });
}

// Called separately by the frontend right after a successful login, only
// if the browser's geolocation prompt was accepted. Attaches exact GPS
// coordinates to the login row created in handleLogin. This is the only
// way to get an EXACT location — IP address alone can only ever give an
// approximate city/region, never a precise position.
async function handleUpdateLocation(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  const { loginLogId, latitude, longitude } = req.body || {};
  if (!loginLogId || typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({ error: 'loginLogId, latitude, and longitude are required.' });
  }

  const { error } = await supabase
    .from('admin_logins')
    .update({ latitude, longitude })
    .eq('id', loginLogId)
    .eq('admin_id', session.sub); // can only update your own login row

  if (error) throw error;
  return res.status(200).json({ ok: true });
}

async function handleDashboard(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  const { data: admin } = await supabase
    .from('admins')
    .select('deactivated_at')
    .eq('id', session.sub)
    .maybeSingle();

  if (admin?.deactivated_at) {
    return res.status(401).json({ error: 'This account has been deactivated.' });
  }

  let productCount = 0;
  let pageCount = 0;

  try {
    const { count } = await supabase.from('products').select('*', { count: 'exact', head: true });
    productCount = count || 0;
  } catch (err) {
    console.error('dashboard: products count failed:', err.message);
  }

  try {
    const { count } = await supabase.from('pages').select('*', { count: 'exact', head: true });
    pageCount = count || 0;
  } catch (err) {
    console.error('dashboard: pages count failed:', err.message);
  }

  return res.status(200).json({
    stats: { products: productCount, pages: pageCount, orders: 0 },
    role: session.role,
    permissions: session.permissions || {},
  });
}

async function handleLoginLogs(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  const { data, error } = await supabase
    .from('admin_logins')
    .select('created_at, ip_address, user_agent, success, attempted_username, latitude, longitude, admins ( username, role )')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('handleLoginLogs failed:', error.message);
    return res.status(500).json({ error: error.message });
  }

  const logins = (data || []).map((row) => ({
    when: row.created_at,
    username: row.admins?.username || row.attempted_username || 'unknown',
    role: row.admins?.role || 'unknown',
    success: row.success,
    ip_address: row.ip_address,
    user_agent: row.user_agent,
    latitude: row.latitude,
    longitude: row.longitude,
  }));

  return res.status(200).json({ logins });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action || (req.body && req.body.action);

  try {
    if (req.method === 'POST' && action === 'login') return await handleLogin(req, res);
    if (req.method === 'POST' && action === 'update-location') return await handleUpdateLocation(req, res);
    if (req.method === 'GET' && action === 'dashboard') return await handleDashboard(req, res);
    if (req.method === 'GET' && action === 'login-logs') return await handleLoginLogs(req, res);
    return res.status(400).json({ error: 'Unknown action: ' + action });
  } catch (err) {
    console.error('admin.js error:', err);
    return res.status(500).json({ error: err.message || 'Unexpected server error.' });
  }
};
