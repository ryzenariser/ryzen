// Roles-dashboard.js/CTO.js — Chief Technology Officer
// Real data only: Vercel deployments, integration env-var presence, database
// reachability, login-security signals, AI error rates, maintenance mode,
// uptime monitors and app builds. Also returns 24-hour hourly series that the
// dashboard charts (sign-ins and AI requests).

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

// 24 hourly buckets ending with the current hour. Rows outside the window are ignored.
// `start` is the epoch ms of the first bucket; the client formats labels in local time.
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
  url.searchParams.set('limit', '10');
  if (env.VERCEL_TEAM_ID) url.searchParams.set('teamId', env.VERCEL_TEAM_ID);
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Vercel API ${res.status}`);
  const json = await res.json();
  return {
    configured: true,
    deployments: (json.deployments || []).map((d) => ({
      state: d.state, // READY | ERROR | BUILDING | QUEUED | CANCELED
      target: d.target || 'preview',
      createdAt: d.createdAt,
      url: d.url,
      commitMessage: (d.meta && d.meta.githubCommitMessage) || null,
    })),
  };
}

module.exports = {
  role: 'CTO',
  title: 'Chief Technology Officer',
  departments: ['Engineering', 'Web Platform', 'Mobile Apps', 'Cybersecurity', 'Cloud/DevOps', 'ERP'],
  notBuilt: ['ERP', 'CPU and RAM monitoring (serverless functions have no fixed machine to measure)'],
  actions: rec.actions,

  async load({ supabase, env, integrationEnvVars, h }) {
    const now = Date.now();
    const since7d = new Date(now - 7 * h.DAY).toISOString();

    const [deployments, database, logins, accounts, aiHealth, maintenance, uptime, builds] = await Promise.all([
      h.safe('cto deployments', () => loadDeployments(env)),

      // One reading per call. The dashboard polls this endpoint, so each refresh adds a point to the live graph.
      h.safe('cto database ping', async () => {
        const started = Date.now();
        const { error } = await supabase.from('admins').select('id').limit(1);
        if (error) throw error;
        return { ok: true, latencyMs: Date.now() - started, checkedAt: Date.now() };
      }, { ok: false, latencyMs: null }),

      h.safe('cto logins', async () => {
        const { data, error } = await supabase
          .from('admin_logins')
          .select('created_at, ip_address, success, attempted_username')
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
          topIps: h.tally(failed, (r) => r.ip_address || 'Unknown IP').slice(0, 3),
          hourly: hourly(rows, (r) => r.success, now),
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
          .select('success, error_message, created_at')
          .gte('created_at', since7d)
          .order('created_at', { ascending: false }) // keep the newest rows if the cap is hit
          .limit(2000);
        if (error) throw error;
        const rows = data || [];
        const failures = rows.filter((r) => !r.success);
        return {
          requests: rows.length,
          failures: failures.length,
          topErrors: h.tally(failures, (r) => (r.error_message || 'Unknown error').slice(0, 120)).slice(0, 3),
          hourly: hourly(rows, (r) => r.success, now),
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
