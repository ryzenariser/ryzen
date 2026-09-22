// Roles-dashboard.js/CHRO.js — Chief Human Resources Officer
// Two things live here: the panel's own login accounts and seats, and the
// staff records you enter (employees, payroll, hiring, training, reviews).
// Salaries are only visible to this seat and the Super Admin.

'use strict';

const { defineRecords, cleanValue, f } = require('./_records.js');
const { httpError } = require('./_helpers.js');

const EMPLOYEE_STATUSES = ['active', 'left'];
const OPENING_STATUSES = ['open', 'interviewing', 'offer', 'filled', 'closed'];

const rec = defineRecords({
  employee: {
    table: 'employees',
    status: { values: EMPLOYEE_STATUSES },
    fields: [
      f.text('fullName', 'full_name', 'Full name', { required: true }),
      f.text('department', 'department', 'Department'),
      f.text('jobTitle', 'job_title', 'Job title'),
      f.date('joinedOn', 'joined_on', 'Joined on'),
      f.number('monthlySalary', 'monthly_salary', 'Monthly salary', { min: 0, max: 100000000 }),
    ],
  },
  'payroll-run': {
    table: 'payroll_runs',
    conflict: 'month,employee_id',
    fields: [
      f.month('month', 'month', 'Month', { required: true }),
      f.uuid('employeeId', 'employee_id', 'Employee', { required: true }),
      f.number('gross', 'gross', 'Gross pay', { required: true, min: 0, max: 100000000 }),
      f.number('deductions', 'deductions', 'Deductions', { min: 0, max: 100000000, dbDefault: true }),
      f.date('paidOn', 'paid_on', 'Paid on'),
    ],
  },
  'job-opening': {
    table: 'job_openings',
    status: { values: OPENING_STATUSES },
    fields: [
      f.text('title', 'title', 'Job title', { required: true }),
      f.text('department', 'department', 'Department'),
      f.enum('status', 'status', 'Stage', OPENING_STATUSES, { dbDefault: true }),
      f.int('applicants', 'applicants', 'Applicants so far', { min: 0, max: 100000, dbDefault: true }),
      f.date('openedOn', 'opened_on', 'Opened on', { dbDefault: true }),
    ],
  },
  training: {
    table: 'training_records',
    fields: [
      f.uuid('employeeId', 'employee_id', 'Employee', { required: true }),
      f.text('course', 'course', 'Course', { required: true }),
      f.date('dueOn', 'due_on', 'Due on'),
      f.date('completedOn', 'completed_on', 'Completed on'),
    ],
  },
  'performance-review': {
    table: 'performance_reviews',
    fields: [
      f.uuid('employeeId', 'employee_id', 'Employee', { required: true }),
      f.text('period', 'period', 'Period (e.g. H1 2026)', { required: true }),
      f.int('rating', 'rating', 'Rating (1 to 5)', { required: true, min: 1, max: 5 }),
      f.text('notes', 'notes', 'Notes', { long: true }),
      f.date('reviewedOn', 'reviewed_on', 'Reviewed on'),
    ],
  },
});

const round1 = (n) => Math.round(n * 10) / 10;

module.exports = {
  role: 'CHRO',
  title: 'Chief Human Resources Officer',
  departments: ['HR & Talent', 'Recruitment', 'Payroll', 'Training', 'Performance', 'Culture'],
  notBuilt: [],

  actions: {
    ...rec.actions,

    'mark-employee-left': (ctx) => rec.actions['update-employee-status']({ ...ctx, body: { id: (ctx.body || {}).id, status: 'left' } }),

    // Sets today's date as the completion date.
    async 'complete-training'({ supabase, body, h }) {
      const id = cleanValue(f.uuid('id', 'id', 'Training record', { required: true }), (body || {}).id);
      const { error } = await supabase.from('training_records').update({ completed_on: h.todayISO() }).eq('id', id);
      if (error) throw httpError(500, 'Could not update the record.');
      return { updated: true };
    },
  },

  async load({ supabase, orgTitles, h }) {
    const [admins, lastLogins, employees, runs, openings, training, reviews] = await Promise.all([
      h.safe('chro admins', () => h.listRows(supabase, 'admins', { columns: 'id, username, role, org_title, deactivated_at, face_reference_path' })),
      h.safe('chro last logins', async () => {
        const { data, error } = await supabase
          .from('admin_logins').select('admin_id, created_at').eq('success', true)
          .order('created_at', { ascending: false }).limit(1000);
        if (error) throw error;
        const latest = {};
        (data || []).forEach((r) => { if (r.admin_id && !latest[r.admin_id]) latest[r.admin_id] = r.created_at; });
        return latest;
      }, {}),
      h.safe('chro employees', () => h.listRows(supabase, 'employees', { order: 'created_at', limit: 500 })),
      h.safe('chro payroll', () => h.listRows(supabase, 'payroll_runs', { order: 'month', limit: 1000 })),
      h.safe('chro openings', () => h.listRows(supabase, 'job_openings', { order: 'opened_on', limit: 100 })),
      h.safe('chro training', () => h.listRows(supabase, 'training_records', { order: 'due_on', ascending: true, limit: 300 })),
      h.safe('chro reviews', () => h.listRows(supabase, 'performance_reviews', { order: 'reviewed_on', limit: 500 })),
    ]);

    // ── panel accounts and seats (unchanged) ──
    let accounts = { staff: null, seats: null };
    if (admins) {
      const active = admins.filter((a) => !a.deactivated_at);
      const holderBySeat = {};
      active.forEach((a) => { if (a.org_title) holderBySeat[a.org_title] = a.username; });
      accounts = {
        counts: {
          activeAccounts: active.length,
          subAdmins: active.filter((a) => a.role !== 'super_admin').length,
          deactivated: admins.length - active.length,
          withoutSeat: active.filter((a) => a.role !== 'super_admin' && !a.org_title).length,
        },
        seats: orgTitles.map((title) => ({ title, holder: holderBySeat[title] || null })),
        staff: active.map((a) => ({
          username: a.username,
          isBoard: a.role === 'super_admin',
          seat: a.role === 'super_admin' ? 'Board of Directors' : (a.org_title || null),
          faceEnrolled: !!a.face_reference_path,
          lastLogin: lastLogins[a.id] || null,
        })),
      };
    }

    // ── staff records ──
    let team = null;
    if (employees) {
      const active = employees.filter((e) => e.status !== 'left');
      const byId = new Map(employees.map((e) => [e.id, e]));
      team = {
        statuses: EMPLOYEE_STATUSES,
        headcount: active.length,
        left: employees.length - active.length,
        byDepartment: h.tally(active, (e) => e.department || 'No department'),
        monthlyPayroll: active.reduce((s, e) => s + (Number(e.monthly_salary) || 0), 0),
        list: employees.slice(0, 60).map((e) => ({
          id: e.id, name: e.full_name, department: e.department, title: e.job_title,
          joinedOn: e.joined_on, salary: e.monthly_salary == null ? null : Number(e.monthly_salary), status: e.status,
        })),
        options: active.map((e) => ({ id: e.id, name: e.full_name, department: e.department })),
        _byId: byId,
      };
    }

    let payroll = null;
    if (runs && team) {
      const perMonth = {};
      runs.forEach((r) => {
        const key = String(r.month).slice(0, 7);
        const slot = perMonth[key] || (perMonth[key] = { month: key, net: 0, people: 0 });
        slot.net += (Number(r.gross) || 0) - (Number(r.deductions) || 0);
        slot.people += 1;
      });
      payroll = {
        months: Object.values(perMonth).sort((a, b) => (a.month < b.month ? 1 : -1)).slice(0, 6),
        list: runs.slice(0, 20).map((r) => ({
          id: r.id, month: String(r.month).slice(0, 7), employee: (team._byId.get(r.employee_id) || {}).full_name || 'Unknown',
          gross: Number(r.gross) || 0, deductions: Number(r.deductions) || 0, paidOn: r.paid_on,
        })),
      };
    }

    let hiring = null;
    if (openings) {
      hiring = {
        statuses: OPENING_STATUSES,
        byStage: h.tally(openings, (o) => o.status),
        openRoles: openings.filter((o) => !['filled', 'closed'].includes(o.status)).length,
        list: openings.slice(0, 30).map((o) => ({
          id: o.id, title: o.title, department: o.department, status: o.status, applicants: o.applicants, openedOn: o.opened_on,
        })),
      };
    }

    let trainingOut = null;
    if (training && team) {
      const pending = training.filter((t) => !t.completed_on);
      trainingOut = {
        overdue: pending.filter((t) => { const d = h.daysUntil(t.due_on); return d !== null && d < 0; }).length,
        pending: pending.length,
        list: pending.slice(0, 25).map((t) => ({
          id: t.id, employee: (team._byId.get(t.employee_id) || {}).full_name || 'Unknown', course: t.course,
          dueOn: t.due_on, daysLeft: h.daysUntil(t.due_on),
        })),
      };
    }

    let reviewsOut = null;
    if (reviews && team) {
      const perDept = {};
      reviews.forEach((r) => {
        const dept = (team._byId.get(r.employee_id) || {}).department || 'No department';
        (perDept[dept] = perDept[dept] || []).push(Number(r.rating) || 0);
      });
      reviewsOut = {
        total: reviews.length,
        byDepartment: Object.entries(perDept).map(([label, list]) => ({ label, avg: round1(list.reduce((s, n) => s + n, 0) / list.length), count: list.length })),
        list: reviews.slice(0, 15).map((r) => ({
          id: r.id, employee: (team._byId.get(r.employee_id) || {}).full_name || 'Unknown', period: r.period, rating: r.rating,
        })),
      };
    }
    if (team) delete team._byId;

    return { ...accounts, team, payroll, hiring, training: trainingOut, reviews: reviewsOut };
  },
};
