import { sha256 } from '../auth/tokens.js'

export type ToolOutcome = 'completed' | 'denied' | 'failed'

export type ToolFailure = 'missing_idempotency_key' | 'execution_error'

export interface ToolEvent {
  outcome: ToolOutcome
  tool: string
  adapter: string
  scope: string
  readOnly: boolean
  durationMs: number
  replayed?: boolean
  failure?: ToolFailure
}

export interface TelemetrySink {
  tool(distinctId: string, event: ToolEvent): void
  exception(error: unknown, distinctId?: string): void
  flush(): Promise<void>
}

export interface Telemetry {
  tool(subject: string, event: ToolEvent): void
  exception(error: unknown, subject?: string): void
  flush(): Promise<void>
}

export const FLUSH_TIMEOUT_MS = 2_000

const EMAIL = /[^\s@]+@[^\s@]+/g

export function scrubbed(error: unknown): Error {
  const source = error instanceof Error ? error : new Error(String(error))
  const clean = new Error(source.message.replace(EMAIL, '[email]'))
  clean.name = source.name
  clean.stack = source.stack?.replace(EMAIL, '[email]')
  return clean
}

export const noSink: TelemetrySink = {
  tool() {},
  exception() {},
  flush: async () => {},
}

function withTimeout(work: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`telemetry flush took longer than ${ms} ms`)), ms)
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

export function telemetry(
  sink: TelemetrySink,
  warn: (message: string) => void = console.warn,
  flushTimeoutMs = FLUSH_TIMEOUT_MS,
): Telemetry {
  const attempt = (action: string, run: () => void) => {
    try {
      run()
    } catch (err) {
      warn(`telemetry ${action} failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return {
    tool: (subject, event) => attempt('tool', () => sink.tool(sha256(subject), event)),
    exception: (error, subject) =>
      attempt('exception', () => sink.exception(scrubbed(error), subject ? sha256(subject) : undefined)),
    flush: async () => {
      try {
        await withTimeout(
          Promise.resolve().then(() => sink.flush()),
          flushTimeoutMs,
        )
      } catch (err) {
        warn(`telemetry flush failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
  }
}
