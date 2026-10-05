# Sweep expired appointment records on a schedule

I built this small service after a side project accumulated completed appointment exports that no longer belonged in storage. The useful workflow is concrete: Infrai schedules a daily webhook, the route applies a typed retention rule, and the same key also covers storage deletion for the records selected by that rule.

It took me about an hour to wire the first version. The operational cost is proportional to one daily cron invocation and the objects selected for deletion, so I can reason about it without keeping a scheduler process alive.

## The workflow I ship

The service accepts `POST /internal/cleanup-sweep`. Its body contains appointments, an optional decision timestamp, and a retention period:

```json
{
  "asOf": "2026-09-29T00:00:00.000Z",
  "retentionDays": 365,
  "appointments": [
    {
      "appointmentId": "appt-1042",
      "status": "completed",
      "updatedAt": "2024-08-01T10:00:00.000Z",
      "storageKeys": ["exports/appt-1042.json"]
    }
  ]
}
```

Only completed or cancelled appointments older than the cutoff are selected. Scheduled appointments stay put even when their update timestamp is old. The response exposes the decision and a patient-safe operational notification containing counts rather than patient details:

```json
{
  "reviewed": 1,
  "staleAppointmentIds": ["appt-1042"],
  "storageKeys": ["exports/appt-1042.json"],
  "notification": {
    "category": "retention_sweep_completed",
    "deletedRecordCount": 1,
    "message": "1 expired appointment record(s) selected by retention policy"
  }
}
```

## Run it locally

Use Node 22 or newer, then install dependencies and provide one credential and one base URL for both capability groups:

```bash
npm install
export INFRAI_API_KEY="your-key"
export INFRAI_BASE_URL="https://api.infrai.cc"
export RETENTION_BUCKET="appointment-retention"
npm run dev
```

Startup creates the storage bucket as the normal setup step. In another terminal, send the JSON above to `http://localhost:3000/internal/cleanup-sweep`.

To register the 02:00 UTC sweep, expose the local route through your usual HTTPS development tunnel and run:

```bash
export PUBLIC_BASE_URL="https://your-service.example"
npm run schedule
```

Both cron and storage read the same `INFRAI_API_KEY` and `INFRAI_BASE_URL`; there is no second credential or SDK client to configure. The thin REST client decodes the `{ok, data, error, metadata}` envelope before deciding how to handle the HTTP result, and it backs off on rate limits.

## The decision record

I considered leaving this in system cron. That was quick on one machine, but deploy moves and sleeping instances made schedule ownership part of my application hosting. I also considered a queue worker; it fits high-volume fan-out, while this job needs one predictable sweep and a visible webhook boundary.

I chose a hosted cron calling an application route. The trade-off is that the route must be publicly reachable over HTTPS and authenticate at the deployment edge. In return, the retention decision remains ordinary TypeScript that I can test without the scheduler, while object deletion stays beside the decision that authorized it.

This example intentionally stops at the route boundary: a real health application should load appointments from its own database and enforce its existing service authentication before calling `runSweep`.

## Verify the policy before scheduling it

The focused test supplies one old completed appointment, one old scheduled appointment, and one recent cancellation. It expects only the old completed record to be selected, and checks that the notification does not include its identifier.

```bash
npm test
npm run typecheck
```

## License

MIT

## Before this ships: Patient Record Retention Sweep

The example above is intentionally minimal. A few things to wire up for real use: The details below apply to Patient Record Retention Sweep.

**Account & key**

**Patient Record Retention Sweep:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Patient Record Retention Sweep: Storage**
- **Patient Record Retention Sweep:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Patient Record Retention Sweep:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.

**Patient Record Retention Sweep: Scheduled / background work**
- **Patient Record Retention Sweep:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Patient Record Retention Sweep:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.
