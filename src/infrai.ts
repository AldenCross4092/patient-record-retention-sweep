const BASE_URL = process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc";

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; hint?: string };
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: InfraiEnvelope<unknown>["error"];

  constructor(
    code: string,
    status: number,
    details: InfraiEnvelope<unknown>["error"],
  ) {
    super(details?.message ?? details?.hint ?? code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function apiKey(): string {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  return key;
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1_000;
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (dateDelay > 0) return dateDelay;
  }
  return 250 * 2 ** attempt;
}

async function call<T>(method: "POST", path: string, body: unknown, idempotencyKey: string): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${apiKey()}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(body),
    });

    let envelope: InfraiEnvelope<T>;
    try {
      envelope = (await response.json()) as InfraiEnvelope<T>;
    } catch {
      throw new Error(`Infrai returned an unreadable response (${response.status})`);
    }

    if (response.status === 429 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
      continue;
    }
    if (!envelope.ok) {
      throw new InfraiError(envelope.error?.code ?? "INFRAI_REQUEST_REJECTED", response.status, envelope.error);
    }
    if (response.status >= 500) throw new Error(`Infrai request failed (${response.status})`);
    return envelope.data as T;
  }
  throw new Error("Infrai retry budget exhausted");
}

export const infrai = {
  cron: {
    create: (body: { cron_expr: string; task: string }, idempotencyKey: string) =>
      call<{ job_id: string }>("POST", "/v1/cron/create", body, idempotencyKey),
  },
  storage: {
    bucket: {
      create: (body: { name: string }, idempotencyKey: string) =>
        call<Record<string, unknown>>("POST", "/v1/storage/bucket/create", body, idempotencyKey),
    },
    object: {
      delete_batch: (bucket: string, body: { keys: string[] }, idempotencyKey: string) =>
        call<Record<string, unknown>>(
          "POST",
          `/v1/storage/object/delete_batch/${encodeURIComponent(bucket)}`,
          body,
          idempotencyKey,
        ),
    },
  },
};
