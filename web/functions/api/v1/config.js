function parseIds(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function onRequestGet(context) {
  const ownerIds = parseIds(context.env.NEXUS_OWNER_DISCORD_IDS);
  const staffIds = parseIds(context.env.NEXUS_STAFF_DISCORD_IDS);

  const checks = [
    {
      id: 'discord-client',
      label: 'Discord OAuth client',
      ready: Boolean(context.env.DISCORD_CLIENT_ID)
    },
    {
      id: 'discord-secret',
      label: 'Discord OAuth secret',
      ready: Boolean(context.env.DISCORD_CLIENT_SECRET)
    },
    {
      id: 'session-secret',
      label: 'Session signing secret',
      ready: Boolean(context.env.NEXUS_SESSION_SECRET)
    },
    {
      id: 'owner-allowlist',
      label: 'Owner allowlist',
      ready: ownerIds.length > 0,
      detail: ownerIds.length > 0 ? `${ownerIds.length} owner account(s)` : undefined
    },
    {
      id: 'staff-allowlist',
      label: 'Staff allowlist',
      ready: staffIds.length > 0 || ownerIds.length > 0,
      detail: `${staffIds.length} staff account(s), ${ownerIds.length} owner account(s)`
    }
  ];

  const readyCount = checks.filter((check) => check.ready).length;

  return Response.json(
    {
      environment: context.env.NEXUS_ENV || 'development',
      releaseLabel: 'Under Development',
      ready: readyCount === checks.length,
      readyCount,
      totalCount: checks.length,
      checks
    },
    {
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    }
  );
}
