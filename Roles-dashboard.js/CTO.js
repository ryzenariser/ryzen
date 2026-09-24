// Roles-dashboard.js/CTO.js — Chief Technology Officer
// Real data only. Sources: Vercel API (deployments), Supabase (admins, admin_logins, ai_usage_logs,
// app_builds, maintenance), UptimeRobot, and env-var presence. Optional columns (failure reason, provider,
// model, tokens, cost) are passed through only when they exist. Nothing is simulated or estimated here.

'use strict';

const { defineRecords, f } = require('./_records.js');
const services = require('./_services.js');

const BUILD_STATUSES = ['building', 'testing', 'submitted', 'live', 'rejected'];
const HOUR = 3600000;

const rec = defineRecords({
  'app-build': {
    table: 'app_builds',
    status: { values: BUILD_STATUSES },
    fields: [
      f.enum('platform', 'platform', 'Platform', ['android', 'ios'], { required: true }),
      f.text('version', 'version', 'Version', { required: true }),
      f.enum('status', 'status', 'Status', BUILD_STATUSES, { dbDefault: true }),
      f.date('releasedOn', 'released_on', 'Released on'),
      f.text('notes', 'notes', 'Notes', { long: true }),
    ],
  },
});

// First present value among candidate column names (schemas differ; nothing is invented).
const pick = (r, ...ks) => { for (const k of ks) if (r[k] != null && r[k] !== '') return r[k]; return null; };
const cut = (v, n) => (v == null ? null : String(v).slice(0, n));
const numOrNull = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const pctile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((sorted.length * p) / 100) - 1)] : null);
const keyOf = (r, ...parts) => String(r.id != null ? r.id : parts.join('|'));

// 24 hourly buckets ending with the current hour. Rows outside the window are ignored.
function hourly(rows, isOk, now) {
  const start = Math.floor(now / HOUR) * HOUR - 23 * HOUR;
  const ok = new Array(24).fill(0);
  const failed = new Array(24).fill(0);
  for (const r of rows) {
    const i = Math.floor((new Date(r.created_at).getTime() - start) / HOUR);
    if (i >= 0 && i < 24) (isOk(r) ? ok : failed)[i]++;
  }
  return { start, ok, failed };
}

async function loadDeployments(env) {
  const token = env.VERCEL_API_TOKEN;
  const projectId = env.VERCEL_PROJECT_ID;
  if (!token || !projectId) {
    return { configured: false, message: 'Add VERCEL_API_TOKEN and VERCEL_PROJECT_ID in Vercel env vars to see real deployments here.' };
  }
  const url = new URL('https://api.vercel.com/v6/deployments');
  url.searchParams.set('projectId', projectId);
  url.searchParams.set('limit', '15');
  if (env.VERCEL_TEAM_ID) url.searchParams.set('teamId', env.VERCEL_TEAM_ID);
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Vercel API ${res.status}`);
  const json = await res.json();
  return {
    configured: true,
    deployments: (json.deployments || []).map((d) => {
      const m = d.meta || {};
      return {
        id: d.uid || d.id || null,
        state: d.state || d.readyState || null, // READY | ERROR | BUILDING | QUEUED | CANCELED
        target: d.target || 'preview',
        createdAt: d.createdAt || d.created || null,
        buildingAt: d.buildingAt || null,
        readyAt: d.ready || null,
        url: d.url || null,
        inspectorUrl: d.inspectorUrl || null,
        commitMessage: m.githubCommitMessage || null,
        sha: m.githubCommitSha || null,
        repo: (m.githubCommitOrg || m.githubOrg) && (m.githubCommitRepo || m.githubRepo) ? `${m.githubCommitOrg || m.githubOrg}/${m.githubCommitRepo || m.githubRepo}` : null,
        branch: m.githubCommitRef || null,
        author: m.githubCommitAuthorLogin || m.githubCommitAuthorName || (d.creator && d.creator.username) || null,
      };
    }),
  };
}

module.exports = {
  role: 'CTO',
  title: 'Chief Technology Officer',
  departments: ['Engineering', 'Web Platform', 'Mobile Apps', 'Cybersecurity', 'Cloud/DevOps', 'ERP'],
  notBuilt: [
    'ERP',
    'CPU and RAM monitoring (serverless functions have no fixed machine to measure)',
    'API request metrics, payments, backups, email/SMS/storage health, log explorer, incidents and alerts, audit log, rollback and other write actions (no data source connected yet)',
  ],
  actions: rec.actions,

  async load({ supabase, env, integrationEnvVars, h }) {
    const now = Date.now();
    const since7d = new Date(now - 7 * h.DAY).toISOString();

    const [deployments, database, logins, accounts, aiHealth, maintenance, uptime, builds] = await Promise.all([
      h.safe('cto deployments', () => loadDeployments(env)),

      // One reading per call. The dashboard polls this endpoint, so every refresh is a real database check.
      h.safe('cto database ping', async () => {
        const started = Date.now();
        const { error } = await supabase.from('admins').select('id').limit(1);
        const latencyMs = Date.now() - started;
        if (error) return { ok: false, latencyMs: null, error: cut(error.message || error.code || 'Query failed', 200), checkedAt: Date.now() };
        return { ok: true, latencyMs, checkedAt: Date.now() };
      }, { ok: false, latencyMs: null, error: 'The database check could not run', checkedAt: Date.now() }),

      h.safe('cto logins', async () => {
        const { data, error } = await supabase
          .from('admin_logins')
          .select('*')
          .gte('created_at', since7d)
          .order('created_at', { ascending: false })
          .limit(500);
        if (error) throw error;
        const rows = data || [];
        const failed = rows.filter((r) => !r.success);
        return {
          total: rows.length,
          failed: failed.length,
          recentFailures: failed.slice(0, 8).map((r) => ({
            at: r.created_at, username: r.attempted_username || null, ip: r.ip_address || null,
          })),
          topIps: h.tally(failed, (r) => r.ip_address || 'Unknown IP').slice(0, 5),
          hourly: hourly(rows, (r) => r.success, now),
          // Whitelisted fields only: never tokens, hashes, face data or anything else in the row.
          events: rows.slice(0, 150).map((r) => ({
            key: keyOf(r, r.created_at, r.ip_address, r.attempted_username),
            id: r.id != null ? String(r.id) : null,
            at: r.created_at,
            ip: r.ip_address || null,
            username: cut(r.attempted_username, 60),
            success: !!r.success,
            reason: cut(pick(r, 'failure_reason', 'reason', 'error_message', 'error'), 160),
            method: cut(pick(r, 'method', 'login_method', 'auth_method'), 40),
            agent: cut(pick(r, 'user_agent', 'device'), 160),
          })),
        };
      }),

      h.safe('cto accounts', async () => {
        const { data, error } = await supabase
          .from('admins')
          .select('face_reference_path, face_lock, deactivated_at, role');
        if (error) throw error;
        const rows = (data || []).filter((a) => !a.deactivated_at);
        return {
          active: rows.length,
          faceEnrolled: rows.filter((a) => !!a.face_reference_path).length,
          faceLocked: rows.filter((a) => !!a.face_lock).length,
          deactivated: (data || []).length - rows.length,
        };
      }),

      h.safe('cto ai health', async () => {
        const { data, error } = await supabase
          .from('ai_usage_logs')
          .select('*')
          .gte('created_at', since7d)
          .order('created_at', { ascending: false }) // keep the newest rows if the cap is hit
          .limit(2000);
        if (error) throw error;
        const rows = data || [];
        const failures = rows.filter((r) => !r.success);
        const P = (r) => cut(pick(r, 'provider', 'ai_provider'), 40);
        const M = (r) => cut(pick(r, 'model', 'model_name'), 60);
        const COST = (r) => numOrNull(pick(r, 'cost', 'cost_usd', 'estimated_cost'));
        const LAT = (r) => numOrNull(pick(r, 'latency_ms', 'duration_ms', 'response_time_ms'));
        const TOK = (r) => {
          const t = numOrNull(pick(r, 'total_tokens', 'tokens'));
          return t != null ? t : (numOrNull(pick(r, 'input_tokens', 'prompt_tokens')) || 0) + (numOrNull(pick(r, 'output_tokens', 'completion_tokens')) || 0);
        };
        const has = (...ks) => rows.some((r) => pick(r, ...ks) != null);
        const fields = {
          provider: has('provider', 'ai_provider'),
          model: has('model', 'model_name'),
          tokens: has('total_tokens', 'tokens', 'input_tokens', 'prompt_tokens', 'output_tokens', 'completion_tokens'),
          cost: has('cost', 'cost_usd', 'estimated_cost'),
          latency: has('latency_ms', 'duration_ms', 'response_time_ms'),
        };
        const groups = new Map();
        if (fields.provider || fields.model) {
          for (const r of rows) {
            const k = `${P(r) || ''}|${M(r) || ''}`;
            if (!groups.has(k)) groups.set(k, { provider: P(r), model: M(r), requests: 0, failures: 0, tokens: 0, cost: 0, lat: [] });
            const g = groups.get(k);
            g.requests++;
            if (!r.success) g.failures++;
            g.tokens += TOK(r);
            g.cost += COST(r) || 0;
            const l = LAT(r);
            if (l != null) g.lat.push(l);
          }
        }
        const models = [...groups.values()].sort((a, b) => b.requests - a.requests).slice(0, 20).map((g) => ({
          provider: g.provider,
          model: g.model,
          requests: g.requests,
          failures: g.failures,
          tokens: fields.tokens ? g.tokens : null,
          cost: fields.cost ? Math.round(g.cost * 10000) / 10000 : null,
          p95Ms: pctile(g.lat.sort((a, b) => a - b), 95),
        }));
        return {
          requests: rows.length,
          failures: failures.length,
          topErrors: h.tally(failures, (r) => (r.error_message || 'Unknown error').slice(0, 120)).slice(0, 3),
          hourly: hourly(rows, (r) => r.success, now),
          fields,
          models: models.length ? models : null,
          events: failures.slice(0, 60).map((r) => ({
            key: keyOf(r, r.created_at, (r.error_message || '').slice(0, 40)),
            at: r.created_at,
            provider: P(r),
            model: M(r),
            error: cut(r.error_message || 'Unknown error', 300),
            type: cut(pick(r, 'error_type', 'error_code', 'status_code'), 40),
            latencyMs: LAT(r),
          })),
        };
      }),

      h.safe('cto maintenance', () => h.loadMaintenance(supabase)),
      h.safe('cto uptime', () => services.uptimeRobot(env)),
      h.safe('cto app builds', () => h.listRows(supabase, 'app_builds', { order: 'released_on', limit: 40 })),
    ]);

    const integrations = Object.entries(integrationEnvVars || {}).map(([key, def]) => ({
      key,
      label: def.label,
      configured: def.vars.every((v) => !!env[v]),
      missing: def.vars.filter((v) => !env[v]),
    }));

    const appBuilds = builds
      ? {
          statuses: BUILD_STATUSES,
          live: builds.filter((b) => b.status === 'live').length,
          inProgress: builds.filter((b) => ['building', 'testing', 'submitted'].includes(b.status)).length,
          list: builds.slice(0, 20).map((b) => ({
            id: b.id, platform: b.platform, version: b.version, status: b.status, releasedOn: b.released_on, notes: b.notes,
          })),
        }
      : null;

    return { deployments, database, integrations, logins, accounts, aiHealth, maintenance, uptime, appBuilds, generatedAt: now };
  },
};
