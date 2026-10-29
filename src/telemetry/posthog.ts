import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs'
import { PostHog } from 'posthog-node'
import type { TelemetryConfig } from './config.js'
import type { TelemetrySink, ToolEvent } from './telemetry.js'

export const POSTHOG_LOGS_PATH = '/i/v1/logs'
export const POSTHOG_TIMEOUT_MS = 2_000

const SEVERITY: Record<ToolEvent['outcome'], string> = { completed: 'info', denied: 'warn', failed: 'error' }

export function properties(event: ToolEvent): Record<string, boolean | number | string> {
  return {
    tool_name: event.tool,
    adapter_name: event.adapter,
    required_scope: event.scope || 'none',
    read_only: event.readOnly,
    duration_ms: event.durationMs,
    ...(event.replayed === undefined ? {} : { replayed: event.replayed }),
    ...(event.failure ? { failure_type: event.failure } : {}),
  }
}

export function posthogSink(config: TelemetryConfig, service: { name: string; version: string }): TelemetrySink {
  const client = new PostHog(config.key, { host: config.host, requestTimeout: POSTHOG_TIMEOUT_MS, fetchRetryCount: 1 })
  const logs = new LoggerProvider({
    resource: resourceFromAttributes({ 'service.name': service.name, 'service.version': service.version }),
    processors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({
          url: new URL(POSTHOG_LOGS_PATH, config.host).toString(),
          headers: { authorization: `Bearer ${config.key}` },
          timeoutMillis: POSTHOG_TIMEOUT_MS,
        }),
      }),
    ],
  })
  const logger = logs.getLogger(service.name)
  return {
    tool(distinctId, event) {
      client.capture({ distinctId, event: `mcp_tool_${event.outcome}`, properties: properties(event) })
      logger.emit({
        severityText: SEVERITY[event.outcome],
        body: `MCP tool ${event.outcome}`,
        attributes: { tool_name: event.tool, adapter_name: event.adapter, outcome: event.outcome },
      })
    },
    exception(error, distinctId) {
      client.captureException(error, distinctId)
    },
    async flush() {
      await Promise.all([client.flush(), logs.forceFlush()])
    },
  }
}
