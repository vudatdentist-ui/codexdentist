import "server-only";

type Bucket = {
  count: number;
  resetAt: number;
};

const globalForRateLimit = globalThis as unknown as {
  loginRateLimit?: Map<string, Bucket>;
  passwordResetRateLimit?: Map<string, Bucket>;
  demoWorkspaceRateLimit?: Map<string, Bucket>;
};

const buckets = globalForRateLimit.loginRateLimit ?? new Map<string, Bucket>();
const passwordResetBuckets = globalForRateLimit.passwordResetRateLimit ?? new Map<string, Bucket>();
const demoWorkspaceBuckets = globalForRateLimit.demoWorkspaceRateLimit ?? new Map<string, Bucket>();
const windowMs = 10 * 60 * 1000;
const maxAttempts = 8;
const passwordResetWindowMs = 60 * 60 * 1000;
const maxPasswordResetAttempts = 5;

globalForRateLimit.loginRateLimit = buckets;
globalForRateLimit.passwordResetRateLimit = passwordResetBuckets;
globalForRateLimit.demoWorkspaceRateLimit = demoWorkspaceBuckets;

const lastPrunedAt = globalThis as unknown as {
  loginRateLimitLastPrunedAt?: number;
};

export function consumeLoginAttempt(key: string) {
  const now = Date.now();
  pruneExpiredBuckets(now);
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, {
      count: 1,
      resetAt: now + windowMs,
    });

    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= maxAttempts) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
    };
  }

  existing.count += 1;

  return { allowed: true, retryAfterSeconds: 0 };
}

export function clearLoginAttempts(key: string) {
  buckets.delete(key);
}

export function consumePasswordResetAttempt(key: string) {
  return consumeBucket({
    buckets: passwordResetBuckets,
    key,
    maxAttempts: maxPasswordResetAttempts,
    windowMs: passwordResetWindowMs,
  });
}

export function consumeDemoWorkspaceAttempt(key: string) {
  return consumeBucket({
    buckets: demoWorkspaceBuckets,
    key,
    maxAttempts: 3,
    windowMs: 24 * 60 * 60 * 1000,
  });
}

function pruneExpiredBuckets(now: number) {
  if ((lastPrunedAt.loginRateLimitLastPrunedAt ?? 0) + windowMs > now) {
    return;
  }

  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }

  lastPrunedAt.loginRateLimitLastPrunedAt = now;
}

function consumeBucket(input: {
  buckets: Map<string, Bucket>;
  key: string;
  maxAttempts: number;
  windowMs: number;
}) {
  const now = Date.now();
  const existing = input.buckets.get(input.key);

  if (!existing || existing.resetAt <= now) {
    input.buckets.set(input.key, {
      count: 1,
      resetAt: now + input.windowMs,
    });

    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= input.maxAttempts) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
    };
  }

  existing.count += 1;

  return { allowed: true, retryAfterSeconds: 0 };
}
