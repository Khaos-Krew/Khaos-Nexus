function clean(value = "") {
  return String(value).replace(/\*\*/g, "").trim();
}

function firstNonEmpty(...values) {
  return values.find((value) => value && String(value).trim()) || "";
}

function normalizeServerName(value = "") {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function parseShinyMessage(message, serverByWebhook = {}) {
  const embed = message.embeds?.[0];
  const title = clean(firstNonEmpty(embed?.title, message.content));
  const description = clean(firstNonEmpty(embed?.description, message.content));
  const footer = clean(embed?.footer?.text || "");
  const combined = `${title}\n${description}\n${footer}`;

  let event = "unknown";
  if (/detected|spawn/i.test(title)) event = "detected";
  else if (/signal lost|anomaly lost|despawn|no longer detectable|disappeared/i.test(combined)) event = "lost";
  else if (/contained|tamed/i.test(combined)) event = "contained";
  else if (/terminated|killed/i.test(combined)) event = "terminated";

  const dinoPatterns = [
    /^(.+?)\s+detected\b/i,
    /^(.+?)\s+is no longer detectable\b/i,
    /^(.+?)\s+has disappeared\b/i,
    /^(.+?)\s+has been contained\b/i,
    /^(.+?)\s+contained by\b/i,
    /^(.+?)\s+was terminated\b/i,
    /^(.+?)\s+terminated by\b/i,
  ];

  let dino = "Unknown Anomaly";
  for (const pattern of dinoPatterns) {
    const match = description.match(pattern);
    if (match?.[1]) {
      dino = clean(match[1]);
      break;
    }
  }

  const mapMatch = description.match(/\bon\s+(.+?)(?:\s+at\b|\s*$)/i);
  const footerBulletMatch = footer.match(/Khaos Nexus\s*[•|\-]\s*(.+)$/i);
  const footerParenMatch = footer.match(/Khaos Nexus\s*\((.+?)\)\s*$/i);
  const mappedServer = clean(serverByWebhook[message.webhookId] || "");
  const payloadServer = clean(firstNonEmpty(
    mapMatch?.[1],
    footerBulletMatch?.[1],
    footerParenMatch?.[1]
  ));

  // ARN uses one Shiny webhook per map. The webhook ID is therefore the
  // authoritative network source. Payload map/footer text remains useful for
  // diagnostics and for detecting accidental cross-wiring.
  const server = clean(firstNonEmpty(mappedServer, payloadServer, "Unknown Server"));
  const sourceMapMismatch = Boolean(
    mappedServer &&
    payloadServer &&
    normalizeServerName(mappedServer) !== normalizeServerName(payloadServer)
  );

  const playerMatch = description.match(/\bby\s+(.+?)(?:\.|,|$)/i);
  const locationMatch = description.match(/\bat\s+(.+?)(?:\.|$)/i);

  return {
    event,
    dino,
    server,
    payloadServer,
    sourceMapMismatch,
    sourceWebhookId: message.webhookId || "",
    player: clean(playerMatch?.[1] || ""),
    location: clean(locationMatch?.[1] || ""),
    sourceTitle: title,
    sourceDescription: description,
    sourceFooter: footer,
  };
}
