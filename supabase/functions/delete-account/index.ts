// supabase/functions/delete-account/index.ts
// Deploy with: supabase functions deploy delete-account
//
// This function permanently deletes a user account.
// Called from AuthFlow when user confirms account deletion.
// Must run server-side because deleting an auth user requires the service role key.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");

    // Verify the user is authenticated
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
    }

    // Use admin client to delete the user
    // This requires SUPABASE_SERVICE_ROLE_KEY, which should never be exposed to the browser
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { error: deleteErr } = await adminClient.auth.admin.deleteUser(userData.user.id);
    if (deleteErr) {
      return new Response(JSON.stringify({ error: deleteErr.message }), { status: 400 });
    }

    // Note: The profiles, addresses, and memberships rows are automatically deleted
    // by the database due to "on delete cascade" constraints we set up in the schema.
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
