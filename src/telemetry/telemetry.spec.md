# Easton MCP telemetry
Sends tool outcomes, unhandled exceptions and logs to PostHog when POSTHOG_KEY and POSTHOG_HOST are set, and stays silent when they are not.

## invariants
- telemetry never fails a call: A telemetry failure never fails a tool call or a response.
  over: a sink whose capture throws and whose flush rejects, an unhandled error behind the bearer guard, and a flush that never settles
  via: a telemetry failure never fails a tool call or a response
  because: PostHog is an observer, so its outage or a slow flush must never reach a coach, and the flush runs after the response through waitUntil with a timeout
  crossing: coach -> posthog
  entrances: none
  refuted: the telemetry wrapper rethrows a sink failure -> the test a telemetry failure never fails a tool call or a response went red (2026-10-24)
  kinds: output
  checklist: destination-confinement declared as telemetry config
  checklist: redaction declared as hashed subject
  checklist: commit-ordered-effects dismissed: the audit row lands before the event, and a lost event changes no state
  checklist: circuit-breaker-policy declared as telemetry never fails a call
  checklist: declared-target-coverage dismissed: one sink, one host
- hashed subject: Telemetry names a coach by a hash of the subject and never by the email.
  over: a whoami call and an exception with a subject, against a recording sink
  via: telemetry names a coach by a hash of the subject and never by the email
  because: PostHog sits outside the state project, so the coach email stays in the audit rows and PostHog sees only the sha256 of the subject
  crossing: coach -> posthog
  entrances: none
  refuted: the telemetry wrapper passes the raw subject to the sink -> the test telemetry names a coach by a hash of the subject and never by the email went red (2026-10-24)
  kinds: output
  checklist: destination-confinement declared as telemetry config
  checklist: redaction declared as hashed subject
  checklist: commit-ordered-effects dismissed: an event changes no state
  checklist: circuit-breaker-policy declared as telemetry never fails a call
  checklist: declared-target-coverage dismissed: one sink, one host
- telemetry config: Telemetry turns on only for a project token and an https host and stays off otherwise.
  over: a full pair, an empty env, a half set pair, a personal key, an http host and a host that is not a URL
  via: telemetry turns on only for a project token and an https host and stays off otherwise
  because: a personal API key must never ship in a server event, and events must leave only over https to the one configured origin
  crossing: coach -> posthog
  entrances: none
  refuted: telemetryConfigFromEnv accepts an http host -> the test telemetry turns on only for a project token and an https host and stays off otherwise went red (2026-10-24)
  kinds: output
  checklist: destination-confinement declared as telemetry config
  checklist: redaction declared as hashed subject
  checklist: commit-ordered-effects dismissed: the config changes no state
  checklist: circuit-breaker-policy dismissed: a bad config turns telemetry off and the server still boots
  checklist: declared-target-coverage dismissed: one sink, one host
