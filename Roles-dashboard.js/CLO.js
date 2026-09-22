// Roles-dashboard.js/CLO.js — Chief Legal Officer
// Real access audit and policy-page checks, plus the records you enter:
// contracts, trademarks, compliance items and a risk register.

'use strict';

const { defineRecords, cleanValue, f } = require('./_records.js');
const { httpError } = require('./_helpers.js');

const CONTRACT_STATUSES = ['active', 'expired', 'terminated'];
const TRADEMARK_STATUSES = ['idea', 'filed', 'registered', 'rejected', 'expired'];
const RISK_STATUSES = ['open', 'mitigated', 'closed'];

// Policy pages a storefront is normally expected to have, matched against
// real page slugs/titles.
const EXPECTED_POLICIES = [
  { label: 'Privacy policy', test: /privacy/i },
  { label: 'Terms and conditions', test: /terms|conditions/i },
  { label: 'Returns / refund policy', test: /return|refund/i },
  { label: 'Shipping policy', test: /shipping|delivery/i },
];

const rec = defineRecords({
  contract: {
    table: 'contracts',
    status: { values: CONTRACT_STATUSES },
    fields: [
      f.text('party', 'party', 'Other party', { required: true }),
      f.text('kind', 'kind', 'Kind (supplier, lease, NDA...)'),
      f.date('startOn', 'start_on', 'Starts on'),
      f.date('expiresOn', 'expires_on', 'Expires on'),
      f.number('value', 'value', 'Value', { min: 0, max: 100000000000 }),
      f.enum('status', 'status', 'Status', CONTRACT_STATUSES, { dbDefault: true }),
      f.url('fileLink', 'file_link', 'Link to the signed file'),
      f.text('notes', 'notes', 'Notes', { long: true }),
    ],
  },
  trademark: {
    table: 'trademarks',
    status: { values: TRADEMARK_STATUSES },
    fields: [
      f.text('name', 'name', 'Name or logo', { required: true }),
      f.text('class', 'class', 'Class'),
      f.text('filingNumber', 'filing_number', 'Filing number'),
      f.enum('status', 'status', 'Status', TRADEMARK_STATUSES, { dbDefault: true }),
      f.date('filedOn', 'filed_on', 'Filed on'),
      f.date('renewOn', 'renew_on', 'Renew by'),
    ],
  },
  'compliance-item': {
    table: 'compliance_items',
    fields: [
      f.text('requirement', 'requirement', 'Requirement', { required: true }),
      f.text('authority', 'authority', 'Authority'),
      f.date('dueOn', 'due_on', 'Due on'),
      f.text('notes', 'notes', 'Notes', { long: true }),
    ],
  },
  risk: {
    table: 'risks',
    status: { values: RISK_STATUSES },
    fields: [
      f.text('title', 'title', 'Risk', { required: true }),
      f.int('likelihood', 'likelihood', 'Likelihood (1 to 5)', { required: true, min: 1, max: 5 }),
      f.int('impact', 'impact', 'Impact (1 to 5)', { required: true, min: 1, max: 5 }),
      f.text('owner', 'owner', 'Owner'),
      f.text('mitigation', 'mitigation', 'What reduces it', { long: true }),
      f.enum('status', 'status', 'Status', RISK_STATUSES, { dbDefault: true }),
    ],
  },
});

module.exports = {
  role: 'CLO',
  title: 'Chief Legal Officer',
  departments: ['Legal', 'Compliance', 'Contracts', 'IP', 'Risk Mgmt', 'Policies'],
  notBuilt: [],

  actions: {
    ...rec.actions,

    async 'mark-compliance-done'({ supabase, body, h }) {
      const id = cleanValue(f.uuid('id', 'id', 'Compliance item', { required: true }), (body || {}).id);
      const { error } = await supabase.from('compliance_items').update({ done: true, done_on: h.todayISO() }).eq('id', id);
      if (error) throw httpError(500, 'Could not update the record.');
      return { updated: true };
    },
  },

  async load({ supabase, h }) {
    const since30d = new Date(Date.now() - 30 * h.DAY).toISOString();

    const [audit, access, policies, contracts, trademarks, compliance, risks] = await Promise.all([
      h.safe('clo audit', async () => {
        const { data, error } = await supabase
          .from('admin_logins').select('created_at, success, attempted_username')
          .gte('created_at', since30d).order('created_at', { ascending: false }).limit(1000);
        if (error) throw error;
        const rows = data || [];
        return {
          total: rows.length,
          failed: rows.filter((r) => !r.success).length,
          recent: rows.slice(0, 15).map((r) => ({ at: r.created_at, username: r.attempted_username || null, success: !!r.success })),
        };
      }),

      h.safe('clo access', async () => {
        const { data, error } = await supabase.from('admins').select('username, role, org_title, permissions, deactivated_at');
        if (error) throw error;
        return (data || [])
          .filter((a) => !a.deactivated_at && a.role !== 'super_admin')
          .map((a) => {
            const p = a.permissions || {};
            return {
              username: a.username,
              seat: a.org_title || null,
              canDelete: Object.keys(p).filter((k) => p[k] && p[k].delete),
              canEdit: Object.keys(p).filter((k) => p[k] && p[k].edit),
              manageAdmins: !!(p.admins && (p.admins.edit || p.admins.delete)),
            };
          });
      }),

      h.safe('clo policies', async () => {
        const { data, error } = await supabase.from('pages').select('slug, title').limit(500);
        if (error) throw error;
        const pages = data || [];
        return EXPECTED_POLICIES.map((p) => {
          const hit = pages.find((pg) => p.test.test(pg.slug || '') || p.test.test(pg.title || ''));
          return { label: p.label, found: !!hit, slug: hit ? hit.slug : null };
        });
      }),

      h.safe('clo contracts', () => h.listRows(supabase, 'contracts', { order: 'expires_on', ascending: true, limit: 200 })),
      h.safe('clo trademarks', () => h.listRows(supabase, 'trademarks', { order: 'renew_on', ascending: true, limit: 100 })),
      h.safe('clo compliance', () => h.listRows(supabase, 'compliance_items', { order: 'due_on', ascending: true, limit: 200 })),
      h.safe('clo risks', () => h.listRows(supabase, 'risks', { limit: 200 })),
    ]);

    let contractsOut = null;
    if (contracts) {
      const list = contracts.map((c) => ({
        id: c.id, party: c.party, kind: c.kind, expiresOn: c.expires_on, value: c.value == null ? null : Number(c.value),
        status: c.status, fileLink: c.file_link, daysLeft: h.daysUntil(c.expires_on),
      }));
      const active = list.filter((c) => c.status === 'active');
      contractsOut = {
        statuses: CONTRACT_STATUSES,
        active: active.length,
        expiringSoon: active.filter((c) => c.daysLeft !== null && c.daysLeft >= 0 && c.daysLeft <= 60).length,
        pastExpiry: active.filter((c) => c.daysLeft !== null && c.daysLeft < 0).length,
        list: list.slice(0, 40),
      };
    }

    let trademarksOut = null;
    if (trademarks) {
      const list = trademarks.map((t) => ({
        id: t.id, name: t.name, class: t.class, filingNumber: t.filing_number, status: t.status, renewOn: t.renew_on, daysLeft: h.daysUntil(t.renew_on),
      }));
      trademarksOut = {
        statuses: TRADEMARK_STATUSES,
        registered: list.filter((t) => t.status === 'registered').length,
        renewalsDue: list.filter((t) => t.daysLeft !== null && t.daysLeft <= 60 && !['rejected', 'expired'].includes(t.status)).length,
        list: list.slice(0, 40),
      };
    }

    let complianceOut = null;
    if (compliance) {
      const list = compliance.map((c) => ({
        id: c.id, requirement: c.requirement, authority: c.authority, dueOn: c.due_on, done: !!c.done, daysLeft: h.daysUntil(c.due_on),
      }));
      const open = list.filter((c) => !c.done);
      complianceOut = {
        open: open.length,
        overdue: open.filter((c) => c.daysLeft !== null && c.daysLeft < 0).length,
        done: list.length - open.length,
        list: [...open, ...list.filter((c) => c.done)].slice(0, 40),
      };
    }

    let risksOut = null;
    if (risks) {
      const list = risks
        .map((r) => ({
          id: r.id, title: r.title, likelihood: r.likelihood, impact: r.impact, score: (r.likelihood || 0) * (r.impact || 0),
          owner: r.owner, mitigation: r.mitigation, status: r.status,
        }))
        .sort((a, b) => b.score - a.score);
      risksOut = {
        statuses: RISK_STATUSES,
        open: list.filter((r) => r.status === 'open').length,
        high: list.filter((r) => r.status === 'open' && r.score >= 15).length,
        list: list.slice(0, 40),
      };
    }

    return { audit, access, policies, contracts: contractsOut, trademarks: trademarksOut, compliance: complianceOut, risks: risksOut };
  },
};
