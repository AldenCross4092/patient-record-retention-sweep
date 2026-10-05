import assert from "node:assert/strict";
import test from "node:test";
import { decideRetentionSweep, SweepRequestSchema } from "../src/retention_policy.js";

test("selects only terminal appointments older than the retention window", () => {
  const input = SweepRequestSchema.parse({
    asOf: "2026-09-29T00:00:00.000Z",
    retentionDays: 365,
    appointments: [
      { appointmentId: "appt-old", status: "completed", updatedAt: "2024-01-10T00:00:00.000Z", storageKeys: ["exports/appt-old.json"] },
      { appointmentId: "appt-upcoming", status: "scheduled", updatedAt: "2024-01-10T00:00:00.000Z", storageKeys: ["exports/appt-upcoming.json"] },
      { appointmentId: "appt-recent", status: "cancelled", updatedAt: "2026-09-01T00:00:00.000Z", storageKeys: ["exports/appt-recent.json"] },
    ],
  });

  const result = decideRetentionSweep(input);

  assert.deepEqual(result.staleAppointmentIds, ["appt-old"]);
  assert.deepEqual(result.storageKeys, ["exports/appt-old.json"]);
  assert.equal(result.notification.deletedRecordCount, 1);
  assert.equal(result.notification.message.includes("appt-old"), false);
});
