export async function onRequestGet() {
  return Response.json(
    {
      authenticated: false,
      user: null
    },
    {
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    }
  );
}
