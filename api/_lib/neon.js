// api/_lib/neon.js
// Pooled Neon Postgres client for Vercel serverless functions.
// Mirrors how api/_lib/supabase.js centralizes the Supabase client.

import { neon } from '@neondatabase/serverless';

if (!process.env.NEON_DATABASE_URL) {
  throw new Error('NEON_DATABASE_URL environment variable is not set');
}

export const sql = neon(process.env.NEON_DATABASE_URL);

export async function logAdminAction({ adminUserId, action, targetTable, targetId, details }) {
  await sql`
    INSERT INTO audit_logs (admin_user_id, action, target_table, target_id, details)
    VALUES (${adminUserId}, ${action}, ${targetTable}, ${targetId}, ${details ? JSON.stringify(details) : null})
  `;
}
