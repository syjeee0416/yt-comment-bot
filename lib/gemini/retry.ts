/**
 * Gemini API 호출용 자동 재시도 유틸.
 *
 * 일시적 (재시도하면 회복): 503/UNAVAILABLE/overloaded, 500/INTERNAL, 502/Bad Gateway, DEADLINE_EXCEEDED
 * 영구 (즉시 throw): 400/401/403/404, 일일 quota 초과
 * RPM(분당) rate limit: 짧은 대기 후 회복 가능 — retry
 */

const RETRYABLE_PATTERNS = [
  /503/,
  /UNAVAILABLE/i,
  /overloaded/i,
  /high demand/i,
  /500/,
  /INTERNAL/i,
  /DEADLINE_EXCEEDED/i,
  /502/,
  /Bad Gateway/i,
];

const PERMANENT_429_PATTERNS = [
  /exceeded your current quota/i,
  /per_day_paid_tier/i,
  /per_day_free_tier/i,
  /QuotaFailure/i,
];

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message ?? "";
  if (err.name === "AbortError") return false;
  if (PERMANENT_429_PATTERNS.some((p) => p.test(message))) return false;
  if (
    /RESOURCE_EXHAUSTED/i.test(message) &&
    /per[\s_-]?minute/i.test(message)
  ) {
    return true;
  }
  if (/RESOURCE_EXHAUSTED/i.test(message) && /retry.{0,10}in\s+\d+/i.test(message)) {
    return true;
  }
  if (/429/.test(message) || /RESOURCE_EXHAUSTED/i.test(message)) return false;
  return RETRYABLE_PATTERNS.some((p) => p.test(message));
}

export type RetryOptions = {
  maxAttempts?: number;
  initialDelayMs?: number;
  backoffMultiplier?: number;
  maxDelayMs?: number;
  label?: string;
  abortSignal?: AbortSignal;
};

const DEFAULTS: Required<Omit<RetryOptions, "label" | "abortSignal">> = {
  maxAttempts: 4,
  initialDelayMs: 2000,
  backoffMultiplier: 2,
  maxDelayMs: 30000,
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted by user", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted by user", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function withGeminiRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const cfg = { ...DEFAULTS, ...options };
  const label = options.label ?? "gemini";
  let lastError: unknown;
  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    if (options.abortSignal?.aborted) {
      throw new DOMException("Aborted by user", "AbortError");
    }
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === cfg.maxAttempts) throw err;
      const delay = Math.min(
        cfg.initialDelayMs * Math.pow(cfg.backoffMultiplier, attempt - 1),
        cfg.maxDelayMs,
      );
      const errMsg = err instanceof Error ? err.message.slice(0, 120) : String(err);
      console.warn(
        `[${label}] retry ${attempt}/${cfg.maxAttempts - 1} in ${delay}ms — ${errMsg}`,
      );
      await sleep(delay, options.abortSignal);
    }
  }
  throw lastError;
}
