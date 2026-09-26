// api/_lib/neon.js
// Pooled Neon Postgres client for Vercel serverless functions.
// CommonJS, to match api/package.json's "type": "commonjs".

const { neon } = require('@neondatabase/serverless');

if (!process.env.NEON_DATABASE_URL) {
  throw new Error('NEON_DATABASE_URL environment variable is not set');
}

const sql = neon(process.env.NEON_DATABASE_URL);

async function logAdminAction({ adminUserId, action, targetTable, targetId, details }) {
  await sql`
    INSERT INTO audit_logs (admin_user_id, action, target_table, target_id, details)
    VALUES (${adminUserId}, ${action}, ${targetTable}, ${targetId}, ${details ? JSON.stringify(details) : null})
  `;
}

module.exports = { sql, logAdminAction };
