export function normalizeMapName(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function mapFromArnWebhookName(value = "") {
  const match = String(value).trim().match(/^ARN\s*-\s*(.+?)\s*$/i);
  return match?.[1]?.trim() || "";
}

export function sameMapName(left = "", right = "") {
  const a = normalizeMapName(left);
  const b = normalizeMapName(right);
  return Boolean(a && b && a === b);
}
