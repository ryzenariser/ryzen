// api/health-check.js
// TEMPORARY — verifies the Neon connection is working.

const { sql } = require('./_lib/neon.js');

module.exports = async function handler(req, res) {
  try {
    const result = await sql`SELECT 1 AS ok, now() AS server_time`;
    return res.status(200).json({
      neon_connected: true,
      result: result[0],
    });
  } catch (err) {
    return res.status(500).json({
      neon_connected: false,
      error: err.message,
    });
  }
};
