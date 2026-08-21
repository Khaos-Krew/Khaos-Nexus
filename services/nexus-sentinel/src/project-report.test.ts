import assert from "node:assert/strict";
import test from "node:test";

import { parseReportTimes, scheduledReportSlot } from "./project-report.js";

test("parseReportTimes normalizes, validates, sorts, and deduplicates", () => {
  assert.deepEqual(parseReportTimes("18:00,07:00,bad,25:00,07:00,06:60"), ["07:00", "18:00"]);
});

test("scheduledReportSlot recognizes the 7 AM Central report and grace window", () => {
  assert.equal(
    scheduledReportSlot(new Date("2026-08-19T12:00:00.000Z"), "America/Chicago", ["07:00", "18:00"], 10),
    "2026-08-19T07:00",
  );
  assert.equal(
    scheduledReportSlot(new Date("2026-08-19T12:09:00.000Z"), "America/Chicago", ["07:00", "18:00"], 10),
    "2026-08-19T07:00",
  );
  assert.equal(
    scheduledReportSlot(new Date("2026-08-19T12:11:00.000Z"), "America/Chicago", ["07:00", "18:00"], 10),
    null,
  );
});

test("scheduledReportSlot recognizes the 6 PM Central report", () => {
  assert.equal(
    scheduledReportSlot(new Date("2026-08-19T23:00:00.000Z"), "America/Chicago", ["07:00", "18:00"], 10),
    "2026-08-19T18:00",
  );
});
