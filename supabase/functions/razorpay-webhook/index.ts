// supabase/functions/razorpay-webhook/index.ts
// Deploy with: supabase functions deploy razorpay-webhook --no-verify-jwt
// (--no-verify-jwt because Razorpay calls this directly, not from client)
//
// This webhook receives subscription events from Razorpay and updates the memberships table.
// After deploying, copy this function's URL into Razorpay Dashboard > Settings > Webhooks

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const WEBHOOK_SECRET = Deno.env.get("RAZORPAY_WEBHOOK_SECRET")!;

async function verifySignature(body: string, signature: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return expected === signature;
}

Deno.serve(async (req) => {
  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature") ?? "";

  // Verify webhook signature (prevents spoofing)
  const valid = await verifySignature(rawBody, signature);
  if (!valid) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 400 });
  }

  const payload = JSON.parse(rawBody);
  const event = payload.event as string;
  const subEntity = payload.payload?.subscription?.entity;
  
  // If no subscription data, just acknowledge receipt
  if (!subEntity) {
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Map Razorpay events to our status values
  const statusMap: Record<string, string> = {
    "subscription.activated": "active",
    "subscription.charged": "active",
    "subscription.cancelled": "cancelled",
    "subscription.halted": "past_due",
    "subscription.completed": "cancelled",
  };
  
  const newStatus = statusMap[event];
  if (!newStatus) {
    // Unknown event type, just acknowledge
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }

  // Convert Razorpay timestamp to ISO 8601
  const currentPeriodEnd = subEntity.current_end
    ? new Date(subEntity.current_end * 1000).toISOString()
    : null;

  // Update the membership record with new status
  await adminClient
    .from("memberships")
    .update({
      status: newStatus,
      current_period_end: currentPeriodEnd,
      updated_at: new Date().toISOString(),
    })
    .eq("razorpay_subscription_id", subEntity.id);

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});
