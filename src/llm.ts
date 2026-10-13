/** Direct OpenAI-compatible call for the cheap classifier/summarizer. */

/**
 * Message content: plain text, or the multimodal array form the vision calls
 * need (sticker descriptions). Data URLs are accepted.
 */
export type ChatContent =
  | string
  | ({ type: 'text', text: string } | { type: 'image_url', image_url: { url: string } })[]

export interface ChatMessage { role: 'system' | 'user' | 'assistant', content: ChatContent }

export interface LlmResult { text: string, input: number, cached: number, output: number }

export interface ChatOptions {
  json?: boolean
  maxTokens?: number
  /** Sampling temperature (default 0.2: the classifier wants the same answer twice). */
  temperature?: number
  signal?: AbortSignal
  /** extra attempts after a transient failure (default 3) */
  retries?: number
  /** wall-clock budget shared by all attempts (default 120s) */
  retryBudgetMs?: number
  /** per-attempt timeout (default 90s, further capped by the remaining budget) */
  timeoutMs?: number
  /** called before each retry, for logging */
  onRetry?: (info: { attempt: number, error: Error, delayMs: number }) => void
}

/** Statuses worth another attempt: the upstream model is briefly unavailable. */
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 507, 522, 524])
/** Backoff before attempt 2, 3, 4 (attempts beyond the list reuse the last entry). */
const RETRY_DELAYS = [2_000, 5_000, 10_000]

/** A failed LLM call. `retryable` marks gateway/network trouble, not a bad request. */
export class LlmError extends Error {
  readonly retryable: boolean
  readonly retryAfterMs?: number

  constructor(message: string, retryable: boolean, retryAfterMs?: number) {
    super(message)
    this.name = 'LlmError'
    this.retryable = retryable
    this.retryAfterMs = retryAfterMs
  }
}

/**
 * Call the chat completions endpoint, retrying transient failures (network errors,
 * timeouts, 429/5xx) a few times with backoff before giving up. Permanent failures
 * (bad request, bad key, …) and caller aborts are thrown on the first attempt.
 */
export async function chat(cfg: { baseURL: string, apiKey: string, model: string }, messages: ChatMessage[], opts: ChatOptions = {}): Promise<LlmResult> {
  const retries = Math.max(0, opts.retries ?? 3)
  const budget = opts.retryBudgetMs ?? 120_000
  const startedAt = Date.now()
  for (let attempt = 0; ; attempt++) {
    const remaining = budget - (Date.now() - startedAt)
    const timeout = Math.max(5_000, Math.min(opts.timeoutMs ?? 90_000, remaining))
    try {
      return await chatOnce(cfg, messages, opts, timeout)
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      const left = budget - (Date.now() - startedAt)
      if (attempt >= retries || !isRetryable(error) || opts.signal?.aborted || left <= 5_000) {
        throw attempt ? new Error(`${failure.message}（含首次共尝试 ${attempt + 1} 次）`) : failure
      }
      const asked = failure instanceof LlmError ? failure.retryAfterMs : undefined
      const delay = Math.min(asked ?? RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)], Math.max(0, left - 1_000))
      opts.onRetry?.({ attempt: attempt + 1, error: failure, delayMs: delay })
      await sleep(delay, opts.signal)
    }
  }
}

async function chatOnce(cfg: { baseURL: string, apiKey: string, model: string }, messages: ChatMessage[], opts: ChatOptions, timeoutMs: number): Promise<LlmResult> {
  const timeout = AbortSignal.timeout(timeoutMs)
  let response: Response
  try {
    response = await fetch(`${cfg.baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        max_tokens: opts.maxTokens ?? 600,
        temperature: opts.temperature ?? 0.2,
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
    })
  } catch (error) {
    if (opts.signal?.aborted) throw error // the caller cancelled: do not retry
    const message = error instanceof Error ? error.message : String(error)
    throw new LlmError(`llm request failed: ${message}`, true)
  }
  const text = await response.text()
  if (!response.ok) {
    throw new LlmError(`llm ${response.status}: ${text.slice(0, 300)}`, RETRYABLE_STATUS.has(response.status), retryAfterMs(response))
  }
  let json: any
  try { json = JSON.parse(text) } catch { throw new LlmError(`llm ${response.status}: 响应不是 JSON：${text.slice(0, 300)}`, true) }
  // some gateways answer 200 with an error envelope
  if (json?.error) throw new LlmError(`llm ${response.status}: ${(typeof json.error === 'string' ? json.error : JSON.stringify(json.error)).slice(0, 300)}`, true)
  const usage = json.usage ?? {}
  const cached = usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0
  return {
    text: json.choices?.[0]?.message?.content ?? '',
    input: Math.max(0, (usage.prompt_tokens ?? 0) - cached),
    cached,
    output: usage.completion_tokens ?? 0,
  }
}

/** Network-level failures (DNS, reset, timeout) are worth retrying; explicit errors carry their own flag. */
function isRetryable(error: unknown): boolean {
  return error instanceof LlmError ? error.retryable : true
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get('retry-after')
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(header)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => { signal?.removeEventListener('abort', aborted); resolve() }
    const aborted = () => { clearTimeout(timer); reject(signal?.reason ?? new Error('aborted')) }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', aborted, { once: true })
  })
}

/** Extract the first JSON object from a model answer (tolerates fences / prose). */
export function parseJsonLoose<T>(text: string): T | undefined {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try { return JSON.parse(text.slice(start, end + 1)) as T } catch { return undefined }
}
