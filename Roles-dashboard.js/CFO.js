// Roles-dashboard.js/CFO.js — Chief Financial Officer
// Revenue from orders (paid / shipped / delivered, same rule as the Reports
// tab) plus the records you enter: product costs, expenses, budgets,
// investments and tax records.

'use strict';

const { defineRecords, f } = require('./_records.js');

const EXPENSE_CATEGORIES = [
  'Materials', 'Manufacturing', 'Salaries', 'Marketing', 'Shipping',
  'Rent and utilities', 'Software', 'Legal and compliance', 'Other',
];

const rec = defineRecords({
  'product-cost': {
    table: 'product_costs',
    idColumn: 'product_name',
    conflict: 'product_name',
    stamp: 'updated_at',
    fields: [
      f.text('productName', 'product_name', 'Product name', { required: true }),
      f.number('costPrice', 'cost_price', 'Cost price', { required: true, min: 0, max: 100000000 }),
      f.text('fabric', 'fabric', 'Fabric'),
      f.text('supplier', 'supplier', 'Supplier'),
    ],
  },
  expense: {
    table: 'expenses',
    fields: [
      f.date('spentOn', 'spent_on', 'Date', { required: true }),
      f.enum('category', 'category', 'Category', EXPENSE_CATEGORIES, { required: true }),
      f.text('description', 'description', 'Description'),
      f.number('amount', 'amount', 'Amount', { required: true, min: 0, max: 1000000000 }),
      f.text('paidTo', 'paid_to', 'Paid to'),
    ],
  },
  // Saving the same month + category again replaces the planned amount.
  budget: {
    table: 'budgets',
    conflict: 'month,category',
    fields: [
      f.month('month', 'month', 'Month', { required: true }),
      f.enum('category', 'category', 'Category', EXPENSE_CATEGORIES, { required: true }),
      f.number('planned', 'planned', 'Planned amount', { required: true, min: 0, max: 1000000000 }),
    ],
  },
  investment: {
    table: 'investments',
    fields: [
      f.text('name', 'name', 'Name', { required: true }),
      f.text('kind', 'kind', 'Kind (equipment, stock, deposit...)'),
      f.number('amount', 'amount', 'Amount put in', { required: true, min: 0, max: 1000000000 }),
      f.date('investedOn', 'invested_on', 'Invested on'),
      f.number('currentValue', 'current_value', 'Current value', { min: 0, max: 1000000000 }),
      f.text('notes', 'notes', 'Notes', { long: true }),
    ],
  },
  'tax-record': {
    table: 'tax_records',
    fields: [
      f.text('period', 'period', 'Period (e.g. Aug 2026)', { required: true }),
      f.text('taxType', 'tax_type', 'Tax type', { dbDefault: true }),
      f.number('collected', 'collected', 'Collected from customers', { min: 0, max: 1000000000, dbDefault: true }),
      f.number('paid', 'paid', 'Paid to government', { min: 0, max: 1000000000, dbDefault: true }),
      f.date('filedOn', 'filed_on', 'Filed on'),
      f.text('notes', 'notes', 'Notes', { long: true }),
    ],
  },
});

// Last N calendar months as 'YYYY-MM', oldest first.
function lastMonths(n) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

module.exports = {
  role: 'CFO',
  title: 'Chief Financial Officer',
  departments: ['Finance', 'Accounting', 'Budgeting', 'Taxation', 'Investment', 'Reporting'],
  notBuilt: [],
  actions: rec.actions,

  async load({ supabase, getJSON, h }) {
    const [rows, marginData, expenses, budgets, investments, taxRecords, productNames] = await Promise.all([
      h.safe('cfo orders', () => h.fetchOrders(supabase)),
      h.safe('cfo margins', () => h.loadMargins(supabase, getJSON)),
      h.safe('cfo expenses', () => h.listRows(supabase, 'expenses', { order: 'spent_on', limit: 1000 })),
      h.safe('cfo budgets', () => h.listRows(supabase, 'budgets', { order: 'month', limit: 300 })),
      h.safe('cfo investments', () => h.listRows(supabase, 'investments', { order: 'created_at', limit: 100 })),
      h.safe('cfo tax', () => h.listRows(supabase, 'tax_records', { order: 'created_at', limit: 36 })),
      h.productNames(getJSON),
    ]);

    let orders = null;
    if (rows) {
      orders = {
        summary: h.summarizeOrders(rows),
        last7: h.windowRevenue(rows, 7, 0),
        prev7: h.windowRevenue(rows, 14, 7),
        last30: h.windowRevenue(rows, 30, 0),
        trend30: h.dailyTrend(rows, 30),
      };
    }

    // Ledger: revenue from paid orders against the expenses you entered.
    let ledger = null;
    if (rows && expenses) {
      ledger = lastMonths(6).map((month) => {
        const revenue = rows
          .filter((o) => h.PAID_STATUSES.includes(o.status) && String(o.created_at).slice(0, 7) === month)
          .reduce((s, o) => s + (Number(o.amount) || 0), 0);
        const spent = expenses
          .filter((e) => String(e.spent_on).slice(0, 7) === month)
          .reduce((s, e) => s + (Number(e.amount) || 0), 0);
        return { month, revenue, expenses: spent, profit: revenue - spent };
      });
    }

    // Budget against actual spend, for the current month.
    let budgetsOut = null;
    if (budgets && expenses) {
      const month = h.todayISO().slice(0, 7);
      const lines = budgets
        .filter((b) => String(b.month).slice(0, 7) === month)
        .map((b) => {
          const actual = expenses
            .filter((e) => e.category === b.category && String(e.spent_on).slice(0, 7) === month)
            .reduce((s, e) => s + (Number(e.amount) || 0), 0);
          const planned = Number(b.planned) || 0;
          return { id: b.id, category: b.category, planned, actual, over: actual > planned };
        });
      budgetsOut = { month, lines, over: lines.filter((l) => l.over).length };
    }

    const investmentsOut = investments
      ? {
          invested: investments.reduce((s, i) => s + (Number(i.amount) || 0), 0),
          currentValue: investments.reduce((s, i) => s + (i.current_value == null ? Number(i.amount) || 0 : Number(i.current_value)), 0),
          list: investments.map((i) => ({
            id: i.id, name: i.name, kind: i.kind, amount: Number(i.amount) || 0,
            currentValue: i.current_value == null ? null : Number(i.current_value),
          })),
        }
      : null;

    const taxOut = taxRecords
      ? {
          collected: taxRecords.reduce((s, t) => s + (Number(t.collected) || 0), 0),
          paid: taxRecords.reduce((s, t) => s + (Number(t.paid) || 0), 0),
          unfiled: taxRecords.filter((t) => !t.filed_on).length,
          list: taxRecords.map((t) => ({
            id: t.id, period: t.period, type: t.tax_type, collected: Number(t.collected) || 0, paid: Number(t.paid) || 0, filedOn: t.filed_on,
          })),
        }
      : null;

    return {
      orders,
      margins: marginData ? marginData.margins : null,
      costs: marginData ? marginData.costs.slice(0, 40).map((c) => ({
        name: c.product_name, cost: Number(c.cost_price), fabric: c.fabric, supplier: c.supplier,
      })) : null,
      ledger,
      expenses: expenses ? {
        categories: EXPENSE_CATEGORIES,
        list: expenses.slice(0, 20).map((e) => ({
          id: e.id, date: e.spent_on, category: e.category, description: e.description, amount: Number(e.amount) || 0, paidTo: e.paid_to,
        })),
      } : { categories: EXPENSE_CATEGORIES, list: null },
      budgets: budgetsOut,
      investments: investmentsOut,
      tax: taxOut,
      productNames,
    };
  },
};
