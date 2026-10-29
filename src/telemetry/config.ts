export interface TelemetryConfig {
  key: string
  host: string
}

type Env = Record<string, string | undefined>

export function telemetryConfigFromEnv(
  env: Env,
  warn: (message: string) => void = console.warn,
): TelemetryConfig | null {
  const key = env.POSTHOG_KEY?.trim()
  const host = env.POSTHOG_HOST?.trim()
  if (!key && !host) return null
  if (!key || !host) {
    warn(`telemetry is off: ${key ? 'POSTHOG_HOST' : 'POSTHOG_KEY'} is missing`)
    return null
  }
  if (!key.startsWith('phc_')) {
    warn('telemetry is off: POSTHOG_KEY is not a project token (phc_)')
    return null
  }
  let url: URL
  try {
    url = new URL(host)
  } catch {
    warn('telemetry is off: POSTHOG_HOST is not a URL')
    return null
  }
  if (url.protocol !== 'https:') {
    warn('telemetry is off: POSTHOG_HOST must use https')
    return null
  }
  return { key, host: url.origin }
}
