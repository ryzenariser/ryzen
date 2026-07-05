// supabase/functions/delete-account/index.ts
// Deploy with: supabase functions deploy delete-account
// This runs server-side because deleting an auth user requires the
// service role key, which must never be shipped to the browser.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");

    // Client scoped to the caller's own token, just to verify who they are
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
    }

    // Admin client with service role, used only to perform the deletion
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { error: deleteErr } = await adminClient.auth.admin.deleteUser(userData.user.id);
    if (deleteErr) {
      return new Response(JSON.stringify({ error: deleteErr.message }), { status: 400 });
    }

    // profiles/addresses rows are removed automatically via "on delete cascade"
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
