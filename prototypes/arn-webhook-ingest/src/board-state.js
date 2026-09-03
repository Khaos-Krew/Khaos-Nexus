function normalized(value = "") {
  return String(value).replace(/\*\*/g, "").trim().toLowerCase();
}

function statusForEvent(event) {
  switch (event) {
    case "detected": return "ACTIVE";
    case "contained": return "CAPTURED";
    case "terminated": return "DEFEATED";
    case "lost": return "SIGNAL LOST";
    default: return "UNKNOWN";
  }
}

export class ArnBoardState {
  constructor({ resolvedTtlMs = 180000, lostTtlMs = 60000 } = {}) {
    this.resolvedTtlMs = resolvedTtlMs;
    this.lostTtlMs = lostTtlMs;
    this.incidents = new Map();
    this.processedSourceIds = new Set();
  }

  process(parsed, classification, source = {}) {
    const sourceMessageId = String(source.messageId || "");
    const at = Number(source.timestamp || Date.now());

    if (sourceMessageId && this.processedSourceIds.has(sourceMessageId)) {
      return { changed: false, reason: "duplicate-source" };
    }
    if (sourceMessageId) this.processedSourceIds.add(sourceMessageId);

    if (parsed.event === "detected") {
      const incidentId = sourceMessageId || `${at}:${parsed.server}:${parsed.dino}`;
      this.incidents.set(incidentId, {
        id: incidentId,
        server: parsed.server,
        dino: parsed.dino,
        location: parsed.location || "",
        player: "",
        classification: { ...classification },
        status: "ACTIVE",
        detectedAt: at,
        updatedAt: at,
        resolvedAt: null,
        expiresAt: null,
        sourceMessageId,
      });
      return { changed: true, incident: this.incidents.get(incidentId) };
    }

    const candidates = [...this.incidents.values()]
      .filter((incident) =>
        incident.status === "ACTIVE" &&
        normalized(incident.server) === normalized(parsed.server) &&
        normalized(incident.dino) === normalized(parsed.dino)
      )
      .sort((a, b) => b.detectedAt - a.detectedAt);

    let incident = candidates[0];
    let orphan = false;

    // If the original detection is outside Discord replay history, still show the
    // resolution briefly instead of silently dropping a valid Shiny lifecycle event.
    if (!incident) {
      orphan = true;
      const incidentId = `orphan:${sourceMessageId || `${at}:${parsed.server}:${parsed.dino}`}`;
      incident = {
        id: incidentId,
        server: parsed.server,
        dino: parsed.dino,
        location: parsed.location || "",
        player: parsed.player || "",
        classification: { ...classification },
        status: statusForEvent(parsed.event),
        detectedAt: at,
        updatedAt: at,
        resolvedAt: at,
        expiresAt: at + (parsed.event === "lost" ? this.lostTtlMs : this.resolvedTtlMs),
        sourceMessageId,
        orphan: true,
      };
      this.incidents.set(incidentId, incident);
    } else {
      incident.status = statusForEvent(parsed.event);
      incident.player = parsed.player || incident.player || "";
      incident.location = parsed.location || incident.location || "";
      incident.updatedAt = at;
      incident.resolvedAt = at;
      incident.expiresAt = at + (parsed.event === "lost" ? this.lostTtlMs : this.resolvedTtlMs);
    }

    return {
      changed: true,
      incident,
      orphan,
      ambiguousMatch: candidates.length > 1,
      candidateCount: candidates.length,
    };
  }

  cleanup(now = Date.now()) {
    let removed = 0;
    for (const [id, incident] of this.incidents) {
      if (incident.expiresAt && incident.expiresAt <= now) {
        this.incidents.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  snapshot() {
    return [...this.incidents.values()].map((incident) => ({
      ...incident,
      classification: { ...incident.classification },
    }));
  }
}
