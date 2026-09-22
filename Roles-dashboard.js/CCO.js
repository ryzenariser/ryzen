// Roles-dashboard.js/CCO.js — Chief Customer Officer
// Real orders and customers, plus the records you enter: support tickets,
// returns, product reviews and loyalty points. The customer lookup (CRM view)
// pulls everything known about one email address.

'use strict';

const { defineRecords, cleanValue, f } = require('./_records.js');

// Set this to the column in your orders table that holds the customer's email
// (check it in Supabase, e.g. 'email' or 'customer_email') to show a
// customer's orders in the lookup. Left null, the lookup skips orders.
const ORDERS_EMAIL_COLUMN = null;

const TICKET_STATUSES = ['open', 'pending', 'resolved'];
const RETURN_STATUSES = ['requested', 'approved', 'received', 'refunded', 'rejected'];

const rec = defineRecords({
  ticket: {
    table: 'support_tickets',
    status: {
      values: TICKET_STATUSES,
      onSet: (s) => ({ resolved_at: s === 'resolved' ? new Date().toISOString() : null }),
    },
    fields: [
      f.email('customerEmail', 'customer_email', 'Customer email'),
      f.text('subject', 'subject', 'Subject', { required: true }),
      f.text('message', 'message', 'Message', { long: true }),
      f.text('orderRef', 'order_ref', 'Order reference'),
      f.enum('status', 'status', 'Status', TICKET_STATUSES, { dbDefault: true }),
    ],
  },
  return: {
    table: 'returns',
    status: { values: RETURN_STATUSES },
    fields: [
      f.text('orderRef', 'order_ref', 'Order reference', { required: true }),
      f.text('reason', 'reason', 'Reason'),
      f.number('refundAmount', 'refund_amount', 'Refund amount', { min: 0, max: 100000000 }),
      f.enum('status', 'status', 'Status', RETURN_STATUSES, { dbDefault: true }),
    ],
  },
  review: {
    table: 'reviews',
    fields: [
      f.text('productName', 'product_name', 'Product', { required: true }),
      f.int('rating', 'rating', 'Rating', { required: true, min: 1, max: 5 }),
      f.text('comment', 'comment', 'Comment', { long: true }),
      f.email('customerEmail', 'customer_email', 'Customer email'),
    ],
  },
  points: {
    table: 'loyalty_points',
    fields: [
      f.email('customerEmail', 'customer_email', 'Customer email', { required: true }),
      f.int('points', 'points', 'Points (negative to take away)', { required: true, min: -1000000, max: 1000000 }),
      f.text('reason', 'reason', 'Reason'),
    ],
  },
});

const round1 = (n) => Math.round(n * 10) / 10;

module.exports = {
  role: 'CCO',
  title: 'Chief Customer Officer',
  departments: ['Customer Care', 'CRM', 'Returns', 'Loyalty', 'Community'],
  notBuilt: [],

  actions: {
    ...rec.actions,

    'resolve-ticket': (ctx) => rec.actions['update-ticket-status']({ ...ctx, body: { id: (ctx.body || {}).id, status: 'resolved' } }),

    // Everything known about one customer, matched by email.
    async 'lookup-customer'({ supabase, body, h }) {
      const email = cleanValue(f.email('email', 'email', 'Email', { required: true }), (body || {}).email);
      const [tickets, points, reviews, orders] = await Promise.all([
        h.safe('cco lookup tickets', async () => {
          const { data, error } = await supabase.from('support_tickets').select('id, subject, status, created_at').eq('customer_email', email).order('created_at', { ascending: false }).limit(20);
          if (error) throw error; return data || [];
        }, []),
        h.safe('cco lookup points', async () => {
          const { data, error } = await supabase.from('loyalty_points').select('points, reason, created_at').eq('customer_email', email).order('created_at', { ascending: false }).limit(50);
          if (error) throw error; return data || [];
        }, []),
        h.safe('cco lookup reviews', async () => {
          const { data, error } = await supabase.from('reviews').select('product_name, rating, created_at').eq('customer_email', email).order('created_at', { ascending: false }).limit(20);
          if (error) throw error; return data || [];
        }, []),
        ORDERS_EMAIL_COLUMN
          ? h.safe('cco lookup orders', async () => {
              const { data, error } = await supabase.from('orders').select('amount, status, created_at').eq(ORDERS_EMAIL_COLUMN, email).order('created_at', { ascending: false }).limit(20);
              if (error) throw error; return data || [];
            }, null)
          : Promise.resolve(null),
      ]);
      return {
        email,
        tickets,
        reviews,
        points: { balance: points.reduce((s, p) => s + (Number(p.points) || 0), 0), history: points.slice(0, 10) },
        orders,
        ordersNote: ORDERS_EMAIL_COLUMN ? null : 'Orders are not linked yet. Set ORDERS_EMAIL_COLUMN in CCO.js to the column that holds the customer email.',
      };
    },
  },

  async load({ supabase, getJSON, h }) {
    const [customers, carts, wishlists, rows, tickets, returns, reviews, points, productNames] = await Promise.all([
      h.countOrNull(supabase, 'customers'),
      h.safe('cco carts', async () => (await h.countRows(supabase, 'cart_items')) + (await h.countRows(supabase, 'customer_cart_items'))),
      h.safe('cco wishlists', async () => (await h.countRows(supabase, 'wishlist_items')) + (await h.countRows(supabase, 'customer_wishlist_items'))),
      h.safe('cco orders', () => h.fetchOrders(supabase)),
      h.safe('cco tickets', () => h.listRows(supabase, 'support_tickets', { order: 'created_at', limit: 200 })),
      h.safe('cco returns', () => h.listRows(supabase, 'returns', { order: 'created_at', limit: 200 })),
      h.safe('cco reviews', () => h.listRows(supabase, 'reviews', { order: 'created_at', limit: 500 })),
      h.safe('cco points', () => h.listRows(supabase, 'loyalty_points', { order: 'created_at', limit: 1000 })),
      h.productNames(getJSON),
    ]);

    let orders = null;
    if (rows) {
      const s = h.summarizeOrders(rows);
      const attention = rows.filter((o) => ['cancelled', 'refunded'].includes(o.status));
      orders = {
        total: s.total,
        delivered: s.byStatus.delivered || 0,
        cancelled: s.byStatus.cancelled || 0,
        refunded: s.byStatus.refunded || 0,
        neverPaid: s.byStatus.created || 0,
        cancelledValue: s.cancelledValue,
        refundedValue: s.refundedValue,
        problemRate: s.total ? Math.round((attention.length / s.total) * 100) : null,
        recentProblems: attention.slice(0, 10).map((o) => ({ status: o.status, amount: Number(o.amount) || 0, createdAt: o.created_at })),
      };
    }

    let ticketsOut = null;
    if (tickets) {
      const open = tickets.filter((t) => t.status !== 'resolved');
      const oldest = open.length ? Math.max(...open.map((t) => Math.floor((Date.now() - new Date(t.created_at).getTime()) / h.DAY))) : null;
      const resolved = tickets.filter((t) => t.status === 'resolved' && t.resolved_at);
      const days = resolved.map((t) => (new Date(t.resolved_at) - new Date(t.created_at)) / h.DAY);
      ticketsOut = {
        total: tickets.length,
        open: open.length,
        oldestOpenDays: oldest,
        avgResolveDays: days.length ? round1(days.reduce((s, n) => s + n, 0) / days.length) : null,
        statuses: TICKET_STATUSES,
        list: tickets.slice(0, 25).map((t) => ({
          id: t.id, subject: t.subject, email: t.customer_email, orderRef: t.order_ref, status: t.status, createdAt: t.created_at,
        })),
      };
    }

    let returnsOut = null;
    if (returns) {
      returnsOut = {
        byStatus: h.tally(returns, (r) => r.status),
        refundedTotal: returns.filter((r) => r.status === 'refunded').reduce((s, r) => s + (Number(r.refund_amount) || 0), 0),
        statuses: RETURN_STATUSES,
        list: returns.slice(0, 25).map((r) => ({
          id: r.id, orderRef: r.order_ref, reason: r.reason, refundAmount: r.refund_amount == null ? null : Number(r.refund_amount), status: r.status,
        })),
      };
    }

    let reviewsOut = null;
    if (reviews) {
      const byProduct = {};
      reviews.forEach((r) => { (byProduct[r.product_name] = byProduct[r.product_name] || []).push(Number(r.rating) || 0); });
      const perProduct = Object.entries(byProduct)
        .map(([product, list]) => ({ product, count: list.length, avg: round1(list.reduce((s, n) => s + n, 0) / list.length) }))
        .sort((a, b) => a.avg - b.avg);
      reviewsOut = {
        total: reviews.length,
        avgRating: reviews.length ? round1(reviews.reduce((s, r) => s + (Number(r.rating) || 0), 0) / reviews.length) : null,
        lowest: perProduct.slice(0, 5),
        list: reviews.slice(0, 12).map((r) => ({ id: r.id, product: r.product_name, rating: r.rating, comment: r.comment })),
      };
    }

    let pointsOut = null;
    if (points) {
      const balances = {};
      points.forEach((p) => { balances[p.customer_email] = (balances[p.customer_email] || 0) + (Number(p.points) || 0); });
      pointsOut = {
        issued: points.filter((p) => Number(p.points) > 0).reduce((s, p) => s + Number(p.points), 0),
        members: Object.keys(balances).length,
        top: Object.entries(balances).map(([email, balance]) => ({ email, balance })).sort((a, b) => b.balance - a.balance).slice(0, 5),
        list: points.slice(0, 15).map((p) => ({ id: p.id, email: p.customer_email, points: p.points, reason: p.reason })),
      };
    }

    return { customers, cartItems: carts, wishlistItems: wishlists, orders, tickets: ticketsOut, returns: returnsOut, reviews: reviewsOut, points: pointsOut, productNames };
  },
};
