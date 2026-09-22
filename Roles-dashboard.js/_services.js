// Roles-dashboard.js/_services.js
//
// Read-only connections to outside services. Each function returns
//   { configured: false, message }   when its Vercel variables are not set, or
//   { configured: true, ... }        with real numbers from the provider.
// It throws if the provider answers with an error, so callers wrap it in
// h.safe() and the page shows "couldn't be loaded" instead of a made-up number.
//
// Keys are only ever read from environment variables on the server and are
// never sent to the browser.

'use strict';

const crypto = require('crypto');

const TIMEOUT_MS = 8000;

async function httpJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = json && (json.error && (json.error.message || json.error)) ? ` (${json.error.message || json.error})` : '';
      throw new Error(`${new URL(url).hostname} answered ${res.status}${detail}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

const notConfigured = (message) => ({ configured: false, message });
const toNumber = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v) || 0);

/* ── Meta Marketing API: ad spend, reach, clicks ─────────────────────────── */
async function metaAds(env, revenueLast30d) {
  if (!env.META_ACCESS_TOKEN || !env.META_AD_ACCOUNT_ID) {
    return notConfigured('Add META_ACCESS_TOKEN and META_AD_ACCOUNT_ID in Vercel to see ad spend and return here.');
  }
  const version = env.META_GRAPH_VERSION || 'v21.0';
  const account = String(env.META_AD_ACCOUNT_ID).replace(/^act_/, '');
  const url = new URL(`https://graph.facebook.com/${version}/act_${account}/insights`);
  url.searchParams.set('fields', 'spend,impressions,clicks,reach');
  url.searchParams.set('date_preset', 'last_30d');
  const json = await httpJson(url.toString(), { headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}` } });
  const row = (json && json.data && json.data[0]) || {};
  const spend = toNumber(row.spend);
  const impressions = toNumber(row.impressions);
  const clicks = toNumber(row.clicks);
  return {
    configured: true,
    period: 'Last 30 days',
    spend,
    impressions,
    clicks,
    reach: toNumber(row.reach),
    ctr: impressions ? Math.round((clicks / impressions) * 1000) / 10 : null,
    revenue: revenueLast30d,
    // Return on ad spend: paid-order revenue divided by ad spend. It counts ALL
    // orders, not only ones the ads brought in, so read it as an upper bound.
    returnOnSpend: spend > 0 ? Math.round((revenueLast30d / spend) * 10) / 10 : null,
  };
}

/* ── Instagram Graph API: followers and recent engagement ────────────────── */
async function instagram(env) {
  if (!env.INSTAGRAM_ACCESS_TOKEN || !env.INSTAGRAM_USER_ID) {
    return notConfigured('Add INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_USER_ID in Vercel to see Instagram numbers here.');
  }
  const version = env.META_GRAPH_VERSION || 'v21.0';
  const headers = { Authorization: `Bearer ${env.INSTAGRAM_ACCESS_TOKEN}` };
  const base = `https://graph.facebook.com/${version}/${encodeURIComponent(env.INSTAGRAM_USER_ID)}`;
  const [profile, media] = await Promise.all([
    httpJson(`${base}?fields=username,followers_count,media_count`, { headers }),
    httpJson(`${base}/media?fields=like_count,comments_count,timestamp&limit=25`, { headers }),
  ]);
  const posts = (media && media.data) || [];
  const avg = (key) => (posts.length ? Math.round((posts.reduce((s, p) => s + toNumber(p[key]), 0) / posts.length) * 10) / 10 : null);
  return {
    configured: true,
    username: profile.username || null,
    followers: toNumber(profile.followers_count),
    posts: toNumber(profile.media_count),
    recentPosts: posts.length,
    avgLikes: avg('like_count'),
    avgComments: avg('comments_count'),
  };
}

/* ── Google Search Console: clicks, impressions, top searches ────────────── */
const b64url = (input) => Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

async function googleAccessToken(account, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: account.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const signature = b64url(signer.sign(String(account.private_key).replace(/\\n/g, '\n')));
  const json = await httpJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claim}.${signature}` }).toString(),
  });
  if (!json || !json.access_token) throw new Error('Google did not return an access token');
  return json.access_token;
}

async function searchConsole(env) {
  if (!env.GSC_SERVICE_ACCOUNT_JSON || !env.GSC_SITE_URL) {
    return notConfigured('Add GSC_SERVICE_ACCOUNT_JSON and GSC_SITE_URL in Vercel to see search rankings here.');
  }
  let account;
  try { account = JSON.parse(env.GSC_SERVICE_ACCOUNT_JSON); } catch (e) {
    return notConfigured('GSC_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the whole key file contents.');
  }
  if (!account.client_email || !account.private_key) {
    return notConfigured('GSC_SERVICE_ACCOUNT_JSON is missing client_email or private_key.');
  }
  const token = await googleAccessToken(account, 'https://www.googleapis.com/auth/webmasters.readonly');
  const day = (offset) => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
  // Search Console data runs about 2 days behind, so end 3 days ago.
  const range = { startDate: day(31), endDate: day(3) };
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(env.GSC_SITE_URL)}/searchAnalytics/query`;
  const post = (body) => httpJson(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...range, ...body }),
  });
  const [totals, queries] = await Promise.all([post({}), post({ dimensions: ['query'], rowLimit: 10 })]);
  const t = (totals.rows && totals.rows[0]) || {};
  return {
    configured: true,
    period: `${range.startDate} to ${range.endDate}`,
    clicks: toNumber(t.clicks),
    impressions: toNumber(t.impressions),
    ctr: t.ctr === undefined ? null : Math.round(toNumber(t.ctr) * 1000) / 10,
    position: t.position === undefined ? null : Math.round(toNumber(t.position) * 10) / 10,
    topQueries: (queries.rows || []).map((r) => ({
      query: (r.keys && r.keys[0]) || '', clicks: toNumber(r.clicks), impressions: toNumber(r.impressions), position: Math.round(toNumber(r.position) * 10) / 10,
    })),
  };
}

/* ── UptimeRobot: is the site up? ────────────────────────────────────────── */
const UPTIME_STATUS = { 0: 'paused', 1: 'not checked yet', 2: 'up', 8: 'seems down', 9: 'down' };

async function uptimeRobot(env) {
  if (!env.UPTIMEROBOT_API_KEY) {
    return notConfigured('Add UPTIMEROBOT_API_KEY in Vercel to see uptime here.');
  }
  const json = await httpJson('https://api.uptimerobot.com/v2/getMonitors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ api_key: env.UPTIMEROBOT_API_KEY, format: 'json', custom_uptime_ratios: '7-30' }).toString(),
  });
  if (!json || json.stat !== 'ok') throw new Error('UptimeRobot did not accept the API key');
  return {
    configured: true,
    monitors: (json.monitors || []).map((m) => {
      const [week, month] = String(m.custom_uptime_ratio || '').split('-');
      return {
        name: m.friendly_name,
        url: m.url,
        status: UPTIME_STATUS[m.status] || 'unknown',
        up: m.status === 2,
        uptime7d: week === undefined || week === '' ? null : Number(week),
        uptime30d: month === undefined || month === '' ? null : Number(month),
      };
    }),
  };
}

module.exports = { metaAds, instagram, searchConsole, uptimeRobot };
