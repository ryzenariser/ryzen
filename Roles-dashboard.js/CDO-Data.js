// Roles-dashboard.js/CDO-Data.js — Chief Data Officer
// Real data only: how much data each table actually holds, the order trend,
// and whether there's enough history for forecasting yet.

'use strict';

const FORECAST_MIN_ORDERS = 10; // same threshold the Marketing forecast uses

const TABLES = [
  ['orders', 'Orders'], ['customers', 'Customers'], ['products', 'Products'], ['pages', 'Pages'],
  ['page_views', 'Page views'], ['cart_items', 'Guest cart items'], ['customer_cart_items', 'Customer cart items'],
  ['wishlist_items', 'Guest wishlist items'], ['customer_wishlist_items', 'Customer wishlist items'],
  ['ai_usage_logs', 'AI usage logs'], ['admin_logins', 'Admin login records'],
];

module.exports = {
  role: 'CDO (Data)',
  title: 'Chief Data Officer',
  departments: ['Business Intelligence', 'Data Engineering', 'Data Analytics', 'Forecasting', 'Reports'],
  notBuilt: ['Data warehouse', 'Data pipelines', 'Custom BI reports'],

  async load({ supabase, h }) {
    const [counts, rows, pageViews] = await Promise.all([
      Promise.all(TABLES.map(async ([table, label]) => ({ table, label, rows: await h.countOrNull(supabase, table) }))),
      h.safe('cdo-data orders', () => h.fetchOrders(supabase)),
      h.safe('cdo-data page views', () => h.loadPageViews(supabase)),
    ]);

    let orders = null;
    if (rows) {
      const summary = h.summarizeOrders(rows);
      const countable = rows.filter((o) => o.status && o.status !== 'created' && o.status !== 'cancelled').length;
      orders = {
        byStatus: summary.byStatus,
        paidCount: summary.paidCount,
        trend30: h.dailyTrend(rows, 30),
        last14: h.windowRevenue(rows, 14, 0),
        prev14: h.windowRevenue(rows, 28, 14),
        forecast: {
          // Same rule as the Marketing forecast: everything except unpaid/cancelled.
          ready: countable >= FORECAST_MIN_ORDERS,
          have: countable,
          need: FORECAST_MIN_ORDERS,
        },
      };
    }

    return { tables: counts, orders, topPaths: pageViews ? pageViews.topPaths : null };
  },
};
