import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { ZodError } from "zod";
import { infrai, InfraiError } from "./infrai.js";
import { decideRetentionSweep, SweepRequestSchema } from "./retention_policy.js";

const bucket = process.env.RETENTION_BUCKET ?? "appointment-retention";

function stableKey(prefix: string, values: string[]): string {
  return `${prefix}-${createHash("sha256").update(values.join("\n")).digest("hex").slice(0, 24)}`;
}

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function ensureRetentionBucket(): Promise<void> {
  try {
    await infrai.storage.bucket.create({ name: bucket }, `retention-bucket-${bucket}`);
  } catch (error) {
    if (!(error instanceof InfraiError) || error.status !== 409) throw error;
  }
}

export async function runSweep(body: unknown) {
  const input = SweepRequestSchema.parse(body);
  const decision = decideRetentionSweep(input);
  if (decision.storageKeys.length > 0) {
    await infrai.storage.object.delete_batch(
      bucket,
      { keys: decision.storageKeys },
      stableKey("retention-delete", decision.storageKeys),
    );
  }
  return decision;
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/internal/cleanup-sweep") {
    response.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not_found" }));
    return;
  }
  try {
    const result = await runSweep(await readJson(request));
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
  } catch (error) {
    const status = error instanceof ZodError ? 400 : error instanceof InfraiError && error.status < 500 ? error.status : 500;
    const message = error instanceof Error ? error.message : "request_failed";
    response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ error: message }));
  }
});

const port = Number(process.env.PORT ?? 3000);
await ensureRetentionBucket();
server.listen(port, () => console.log(`Retention sweep listening on http://localhost:${port}`));
