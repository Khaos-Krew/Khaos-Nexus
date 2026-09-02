'use strict';

function parseListPlayersCount(output) {
  const text = String(output ?? '').trim();
  if (!text) return 0;
  if (/no players connected/i.test(text)) return 0;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const playerLines = lines.filter((line) => /^\d+\.\s+/.test(line));
  if (playerLines.length) return playerLines.length;
  return null;
}

function occupiedOrUnknown(count) {
  return count === null || count > 0;
}

module.exports = { parseListPlayersCount, occupiedOrUnknown };
