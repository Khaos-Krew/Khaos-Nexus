function clean(value = "") {
  return String(value).replace(/\*\*/g, "").trim();
}

function firstNonEmpty(...values) {
  return values.find((value) => value && String(value).trim()) || "";
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
  const mappedServer = serverByWebhook[message.webhookId] || "";

  // Prefer event payload/footer data because Genesis 1 and Astraeos may share
  // the same Discord webhook URL/ID. Webhook mapping is only a fallback.
  const server = clean(firstNonEmpty(
    mapMatch?.[1],
    footerBulletMatch?.[1],
    footerParenMatch?.[1],
    mappedServer,
    "Unknown Server"
  ));

  const playerMatch = description.match(/\bby\s+(.+?)(?:\.|,|$)/i);
  const locationMatch = description.match(/\bat\s+(.+?)(?:\.|$)/i);

  return {
    event,
    dino,
    server,
    player: clean(playerMatch?.[1] || ""),
    location: clean(locationMatch?.[1] || ""),
    sourceTitle: title,
    sourceDescription: description,
    sourceFooter: footer,
  };
}
