export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico|api/|admin).*)',
};

export default async function middleware(request) {
  try {
    const res = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/site_settings?id=eq.1&select=maintenance_mode,backup_url`,
      {
        headers: {
          apikey: process.env.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        },
        cache: 'no-store',
      }
    );
    const data = await res.json();
    const settings = data?.[0];

    if (settings?.maintenance_mode) {
      return Response.redirect(settings.backup_url, 307);
    }
  } catch (err) {
    console.error('maintenance check failed', err);
  }
}
