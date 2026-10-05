import { infrai } from "./infrai.js";

const publicBaseUrl = process.env.PUBLIC_BASE_URL;
if (!publicBaseUrl) throw new Error("PUBLIC_BASE_URL is required");

const task = new URL("/internal/cleanup-sweep", publicBaseUrl).toString();
const result = await infrai.cron.create(
  { cron_expr: "0 2 * * *", task },
  `appointment-retention-daily-${task}`,
);

console.log(JSON.stringify({ scheduled: true, jobId: result.job_id, task }, null, 2));
