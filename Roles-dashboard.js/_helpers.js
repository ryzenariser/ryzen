// Roles-dashboard.js/_helpers.js
// Small shared helpers used by every role module. Nothing here is fake or
// placeholder data — every function reads real rows or returns null when
// the source can't be reached, so the dashboard can say so honestly.

'use strict';

const DAY = 86400000;

// Same vocabulary the Reports tab in admin.html uses.
const PAID_STATUSES = ['paid', 'shipped', 'delivered'];
const CLOSED_STATUSES = ['delivered', 'cancelled', 'refunded'];

// An error that carries an HTTP status, so actions can say "400: bad input".
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Run a loader; on failure log it and hand back a fallback (default null)
// instead of throwing, so one broken source never blanks a whole dashboard.
async function safe(label, fn, fallback = null) {
  try {
    return await fn();
  } catch (err) {
    console.error(`roles-dashboard: ${label} failed:`, err && err.message);
    return fallback;
  }
}

async function countRows(supabase, table) {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count || 0;
}

// null (not 0) when the table can't be read — "0" would be a claim.
const countOrNull = (supabase, table) => safe(`count ${table}`, () => countRows(supabase, table), null);

async function fetchOrders(supabase) {
  const { data, error } = await supabase
    .from('orders')
    .select('amount, status, tracking_number, created_at')
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) throw error;
  return data || [];
}

function summarizeOrders(rows) {
  const byStatus = {};
  let revenue = 0, paidCount = 0, unpaidValue = 0, refundedValue = 0, cancelledValue = 0;
  for (const o of rows) {
    const status = o.status || 'unknown';
    const amount = Number(o.amount) || 0;
    byStatus[status] = (byStatus[status] || 0) + 1;
    if (PAID_STATUSES.includes(status)) { revenue += amount; paidCount += 1; }
    else if (status === 'created') unpaidValue += amount;
    else if (status === 'refunded') refundedValue += amount;
    else if (status === 'cancelled') cancelledValue += amount;
  }
  return {
    total: rows.length,
    truncated: rows.length >= 5000,
    byStatus,
    revenue,
    paidCount,
    avgOrderValue: paidCount ? Math.round(revenue / paidCount) : 0,
    unpaidValue,
    refundedValue,
    cancelledValue,
  };
}

// Paid orders per day for the last `days` days (oldest first).
function dailyTrend(rows, days = 30) {
  const buckets = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * DAY).toISOString().slice(0, 10);
    buckets.set(date, { date, orders: 0, revenue: 0 });
  }
  for (const o of rows) {
    if (!PAID_STATUSES.includes(o.status)) continue;
    const bucket = buckets.get(String(o.created_at).slice(0, 10));
    if (bucket) { bucket.orders += 1; bucket.revenue += Number(o.amount) || 0; }
  }
  return [...buckets.values()];
}

// Revenue from paid orders created between `fromDaysAgo` and `toDaysAgo`.
function windowRevenue(rows, fromDaysAgo, toDaysAgo) {
  const now = Date.now();
  let revenue = 0, orders = 0;
  for (const o of rows) {
    if (!PAID_STATUSES.includes(o.status)) continue;
    const age = now - new Date(o.created_at).getTime();
    if (age >= toDaysAgo * DAY && age < fromDaysAgo * DAY) { revenue += Number(o.amount) || 0; orders += 1; }
  }
  return { revenue, orders };
}

// Not closed, older than N days, and no tracking number — same rule the
// COO's weekly Telegram check uses.
function staleOrders(rows, days = 5) {
  const cutoff = Date.now() - days * DAY;
  return rows.filter((o) =>
    !CLOSED_STATUSES.includes(o.status) &&
    !o.tracking_number &&
    new Date(o.created_at).getTime() < cutoff
  );
}

function tally(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    if (key === null || key === undefined || key === '') continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

// products.json lives in the GitHub content repo (same source the Marketing
// tab reads). Returns null if it can't be loaded.
async function loadProducts(getJSON) {
  const { data } = await getJSON('public/products.json');
  return Array.isArray(data) ? data : null;
}

async function loadPageViews(supabase) {
  const { data, count, error } = await supabase.from('page_views').select('path', { count: 'exact' }).limit(2000);
  if (error) throw error;
  const topPaths = tally(data || [], (v) => v.path).slice(0, 10).map((t) => ({ path: t.label, views: t.count }));
  return { count: count || 0, topPaths };
}

async function loadMaintenance(supabase) {
  const { data, error } = await supabase
    .from('store_maintenance_status')
    .select('is_on, reason, updated_at')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  return { on: !!(data && data.is_on), reason: data ? data.reason : null, updatedAt: data ? data.updated_at : null };
}

const todayISO = () => new Date().toISOString().slice(0, 10);

// Whole days from today until a YYYY-MM-DD date (negative = already past).
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const then = Date.parse(String(dateStr).slice(0, 10) + 'T00:00:00Z');
  const today = Date.parse(todayISO() + 'T00:00:00Z');
  return Number.isNaN(then) ? null : Math.round((then - today) / DAY);
}

// Read rows from any table. Throws on error, so wrap the call in safe().
async function listRows(supabase, table, { columns = '*', order, ascending = false, limit = 200 } = {}) {
  let query = supabase.from(table).select(columns);
  if (order) query = query.order(order, { ascending });
  const { data, error } = await query.limit(limit);
  if (error) throw error;
  return data || [];
}

// Product names from the catalog, used to suggest names in forms.
async function productNames(getJSON) {
  try {
    const list = await loadProducts(getJSON);
    return list ? list.map((p) => p.name).filter(Boolean) : [];
  } catch (err) {
    return [];
  }
}

// Catalog price minus the cost entered in product_costs.
async function loadMargins(supabase, getJSON) {
  const [costs, products] = await Promise.all([
    listRows(supabase, 'product_costs', { columns: 'product_name, cost_price, fabric, supplier, updated_at', order: 'updated_at', limit: 300 }),
    loadProducts(getJSON),
  ]);
  let margins = { covered: 0, totalProducts: products ? products.length : null, averageMarginPct: null, lowest: [] };
  if (products) {
    const costByName = new Map(costs.map((c) => [c.product_name, Number(c.cost_price)]));
    const priced = products
      .filter((p) => costByName.has(p.name) && Number(p.price) > 0)
      .map((p) => {
        const price = Number(p.price), cost = costByName.get(p.name);
        return { name: p.name, price, cost, marginPct: Math.round(((price - cost) / price) * 100) };
      })
      .sort((a, b) => a.marginPct - b.marginPct);
    const totalPct = priced.reduce((sum, p) => sum + p.marginPct, 0);
    margins = {
      covered: priced.length,
      totalProducts: products.length,
      averageMarginPct: priced.length ? Math.round(totalPct / priced.length) : null,
      lowest: priced.slice(0, 5),
    };
  }
  return { margins, costs };
}

module.exports = {
  DAY, PAID_STATUSES, CLOSED_STATUSES,
  todayISO, daysUntil, listRows, productNames, loadMargins,
  httpError, safe, countRows, countOrNull, fetchOrders, summarizeOrders, dailyTrend, windowRevenue, staleOrders,
  tally, loadProducts, loadPageViews, loadMaintenance,
};
