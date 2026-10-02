'use strict';

const CLASS_NAMES = new Map([
  [3655393761, 'Titan'],
  [671679327, 'Hunter'],
  [2271682572, 'Warlock']
]);

const PLATFORMS = new Map([
  [1, 'Xbox'],
  [2, 'PlayStation'],
  [3, 'Steam'],
  [4, 'Blizzard'],
  [5, 'Stadia'],
  [6, 'Epic'],
  [254, 'Bungie']
]);

function parseBungieName(value) {
  const match = String(value || '').trim().match(/^([^#]{1,32})#(\d{1,4})$/);
  if (!match) return null;
  const displayName = match[1].trim();
  if (!displayName) return null;
  return {
    displayName,
    displayNameCode: Number(match[2]),
    label: `${displayName}#${match[2].padStart(4, '0')}`
  };
}

function componentPrivate(component) {
  return !component || component.privacy === 2 || component.data == null;
}

function className(classHash, manifest) {
  const fromManifest = manifest?.nameFor?.('DestinyClassDefinition', classHash);
  if (fromManifest) return fromManifest;
  return CLASS_NAMES.get(Number(classHash) >>> 0) || 'Guardian';
}

function exoticNames(items, manifest) {
  const names = [];
  for (const item of items || []) {
    const definition = manifest?.definition?.('DestinyInventoryItemDefinition', item?.itemHash);
    const tier = Number(definition?.inventory?.tierType);
    const tierName = String(definition?.inventory?.tierTypeName || '');
    if (tier !== 6 && tierName.toLowerCase() !== 'exotic') continue;
    const name = String(definition?.displayProperties?.name || '').trim();
    if (name) names.push(name);
  }
  return names;
}

function renderPlayer({ name, profile, linked, manifest }) {
  const lines = [`**${name.label}**`];
  const profiles = linked?.Response?.profiles || [];
  const primary = profiles.find((row) => row?.isCrossSavePrimary) || null;
  if (primary) {
    const platform = PLATFORMS.get(Number(primary.membershipType)) || 'Unknown platform';
    lines.push(`Cross-save primary: ${platform}`);
  }
  const characters = profile?.Response?.characters;
  if (componentPrivate(characters)) {
    lines.push('Characters: Private');
  } else {
    const rows = Object.values(characters.data || {});
    if (!rows.length) lines.push('Characters: none');
    else {
      lines.push('Characters:');
      for (const character of rows) {
        const title = className(character.classHash, manifest);
        const light = Number(character.light);
        lines.push(`• ${title} — ${Number.isFinite(light) ? light : 'unknown'} Light`);
      }
    }
  }
  const equipment = profile?.Response?.characterEquipment;
  if (componentPrivate(equipment)) {
    lines.push('Exotics: Private');
  } else {
    const items = Object.values(equipment.data || {}).flatMap((row) => row?.items || []);
    const names = exoticNames(items, manifest);
    lines.push(names.length ? `Exotics:\n${names.map((item) => `• ${item}`).join('\n')}` : 'Exotics: none equipped');
  }
  return lines.join('\n').slice(0, 3900);
}

function pickMembership(searchJson, linkedJson) {
  const rows = Array.isArray(searchJson?.Response) ? searchJson.Response : [];
  if (!rows.length) return null;
  const profiles = linkedJson?.Response?.profiles || [];
  const primary = profiles.find((row) => row?.isCrossSavePrimary);
  if (primary) {
    const match = rows.find((row) => String(row.membershipId) === String(primary.membershipId))
      || rows.find((row) => Number(row.membershipType) === Number(primary.membershipType));
    if (match) return match;
    return {
      membershipType: primary.membershipType,
      membershipId: primary.membershipId
    };
  }
  return rows[0];
}

async function lookupPlayer({ client, manifest, cache, rawName }) {
  const name = parseBungieName(rawName);
  if (!name) return { ok: false, reason: 'name' };
  const key = `player:${name.label.toLowerCase()}`;
  const cached = cache?.get?.(key);
  if (cached) return cached;
  const search = await client.post('/Destiny2/SearchDestinyPlayerByBungieName/-1/', {
    displayName: name.displayName,
    displayNameCode: name.displayNameCode
  });
  if (search.kind === 'privacy') return finish(cache, key, { ok: false, reason: 'private' });
  if (search.kind === 'not-found') return finish(cache, key, { ok: false, reason: 'not-found' });
  if (!search.ok) return { ok: false, reason: search.reason || search.kind || 'unavailable' };
  const rows = Array.isArray(search.json?.Response) ? search.json.Response : [];
  if (!rows.length) return finish(cache, key, { ok: false, reason: 'not-found' });
  const first = rows[0];
  const linked = await client.get(
    `/Destiny2/${first.membershipType}/Profile/${first.membershipId}/LinkedProfiles/`,
    { getAllMemberships: 'true' }
  );
  const membership = pickMembership(search.json, linked.ok ? linked.json : null);
  if (!membership?.membershipId) return finish(cache, key, { ok: false, reason: 'not-found' });
  const profile = await client.get(
    `/Destiny2/${membership.membershipType}/Profile/${membership.membershipId}/`,
    { components: '100,200,205' }
  );
  if (profile.kind === 'privacy') return finish(cache, key, { ok: false, reason: 'private' });
  if (profile.kind === 'not-found') return finish(cache, key, { ok: false, reason: 'not-found' });
  if (!profile.ok) return { ok: false, reason: profile.reason || profile.kind || 'unavailable' };
  const text = renderPlayer({
    name,
    profile: profile.json,
    linked: linked.ok ? linked.json : null,
    manifest
  });
  return finish(cache, key, { ok: true, text, privateSections: text.includes('Private') });
}

function finish(cache, key, value) {
  if (value.ok || value.reason === 'private' || value.reason === 'not-found') cache?.set?.(key, value);
  return value;
}

module.exports = {
  CLASS_NAMES,
  PLATFORMS,
  parseBungieName,
  componentPrivate,
  renderPlayer,
  pickMembership,
  lookupPlayer
};
