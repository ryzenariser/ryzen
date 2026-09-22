// Roles-dashboard.js/CAIO.js — Chief AI & Innovation Officer
// Real data only: AI usage logs (Gemini calls), which role agents are
// switched on, Telegram bot connections, face-recognition coverage.

'use strict';

module.exports = {
  role: 'CAIO',
  title: 'Chief AI & Innovation Officer',
  departments: ['Razariser AI', 'AI Agents', 'Automation', 'AI Analytics', 'AI Support', 'AI Research'],
  notBuilt: ['Local LLM / GPU hosting', 'Agent framework beyond the built-in role assistants', 'AI research tracking'],

  async load({ supabase, env, orgTitles, h }) {
    const since30d = new Date(Date.now() - 30 * h.DAY).toISOString();

    const [usage, activeRoles, telegram, face] = await Promise.all([
      h.safe('caio usage', async () => {
        const { data, error } = await supabase
          .from('ai_usage_logs')
          .select('feature, persona, success, error_message, tokens_in, tokens_out, latency_ms, created_at')
          .gte('created_at', since30d)
          .order('created_at', { ascending: false })
          .limit(3000);
        if (error) throw error;
        const rows = data || [];
        const ok = rows.filter((r) => r.success).length;
        const latencies = rows.map((r) => Number(r.latency_ms)).filter((n) => n > 0);
        const byPersona = h.tally(rows, (r) => r.persona || 'personal').map((p) => {
          const mine = rows.filter((r) => (r.persona || 'personal') === p.label);
          return { persona: p.label, requests: p.count, successRate: Math.round((mine.filter((r) => r.success).length / mine.length) * 100) };
        });
        return {
          requests: rows.length,
          successRate: rows.length ? Math.round((ok / rows.length) * 100) : null,
          tokensIn: rows.reduce((s, r) => s + (Number(r.tokens_in) || 0), 0),
          tokensOut: rows.reduce((s, r) => s + (Number(r.tokens_out) || 0), 0),
          avgLatencyMs: latencies.length ? Math.round(latencies.reduce((s, n) => s + n, 0) / latencies.length) : null,
          byPersona,
          byFeature: h.tally(rows, (r) => r.feature).slice(0, 8),
          recentFailures: rows.filter((r) => !r.success).slice(0, 8).map((r) => ({
            at: r.created_at, feature: r.feature, persona: r.persona || null, message: (r.error_message || '').slice(0, 160),
          })),
        };
      }),

      h.safe('caio active roles', async () => {
        const { data, error } = await supabase.from('admin_active_roles').select('role_title');
        if (error) throw error;
        return h.tally(data || [], (r) => r.role_title);
      }),

      h.safe('caio telegram', async () => {
        const { data, error } = await supabase.from('telegram_role_bots').select('role_title, chat_id');
        if (error) throw error;
        return { connected: (data || []).filter((r) => r.chat_id).length, total: orgTitles.length };
      }),

      h.safe('caio face', async () => {
        const { data, error } = await supabase.from('admins').select('face_reference_path, deactivated_at');
        if (error) throw error;
        const active = (data || []).filter((a) => !a.deactivated_at);
        return { enrolled: active.filter((a) => !!a.face_reference_path).length, accounts: active.length };
      }),
    ]);

    return { geminiConfigured: !!env.GEMINI_API_KEY, usage, activeRoles, telegram, face };
  },
};
