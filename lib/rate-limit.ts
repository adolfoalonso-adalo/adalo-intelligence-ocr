type RateLimitEntry = {
  count: number;
  resetAt: number;
};

export type RateLimitOptions = {
  key: string;
  namespace: string;
  limit: number;
  windowSeconds: number;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
};

type UpstashResponse<T> = {
  result?: T;
  error?: string;
};

declare global {
  var __adaloRateLimitStore: Map<string, RateLimitEntry> | undefined;
}

const memoryStore = globalThis.__adaloRateLimitStore ?? new Map<string, RateLimitEntry>();
globalThis.__adaloRateLimitStore = memoryStore;

export function getClientIp(headers: Headers) {
  const forwardedFor = headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return (
    headers.get("x-real-ip") ||
    headers.get("cf-connecting-ip") ||
    headers.get("x-vercel-forwarded-for") ||
    "unknown"
  );
}

export function getOcrRateLimitConfig() {
  return {
    limit: readPositiveInteger(process.env.RATE_LIMIT_OCR_REQUESTS, 5),
    windowSeconds: readPositiveInteger(process.env.RATE_LIMIT_OCR_WINDOW_SECONDS, 600),
  };
}

export async function checkRateLimit(options: RateLimitOptions): Promise<RateLimitResult> {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (redisUrl && redisToken) {
    try {
      return await checkUpstashRateLimit(options, redisUrl, redisToken);
    } catch (error) {
      console.warn("Redis rate limit failed, falling back to in-memory store", error);
    }
  }

  return checkMemoryRateLimit(options);
}

export function createRateLimitHeaders(result: RateLimitResult) {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };
}

function checkMemoryRateLimit({
  key,
  namespace,
  limit,
  windowSeconds,
}: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const id = `${namespace}:${key}`;
  const current = memoryStore.get(id);

  if (!current || current.resetAt <= now) {
    const resetAt = now + windowSeconds * 1000;
    memoryStore.set(id, { count: 1, resetAt });
    pruneExpiredEntries(now);

    return {
      allowed: true,
      limit,
      remaining: Math.max(limit - 1, 0),
      resetAt,
    };
  }

  current.count += 1;
  memoryStore.set(id, current);

  return {
    allowed: current.count <= limit,
    limit,
    remaining: Math.max(limit - current.count, 0),
    resetAt: current.resetAt,
  };
}

async function checkUpstashRateLimit(
  { key, namespace, limit, windowSeconds }: RateLimitOptions,
  redisUrl: string,
  redisToken: string,
): Promise<RateLimitResult> {
  const now = Date.now();
  const redisKey = `rate-limit:${namespace}:${key}`;
  const count = await upstashCommand<number>(redisUrl, redisToken, ["INCR", redisKey]);

  if (count === 1) {
    await upstashCommand<number>(redisUrl, redisToken, ["EXPIRE", redisKey, String(windowSeconds)]);
  }

  return {
    allowed: count <= limit,
    limit,
    remaining: Math.max(limit - count, 0),
    resetAt: now + windowSeconds * 1000,
  };
}

async function upstashCommand<T>(
  redisUrl: string,
  redisToken: string,
  command: string[],
): Promise<T> {
  const response = await fetch(redisUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${redisToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Upstash request failed with status ${response.status}`);
  }

  const data = (await response.json()) as UpstashResponse<T>;

  if (data.error) {
    throw new Error(data.error);
  }

  return data.result as T;
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function pruneExpiredEntries(now: number) {
  for (const [key, value] of memoryStore.entries()) {
    if (value.resetAt <= now) {
      memoryStore.delete(key);
    }
  }
}
