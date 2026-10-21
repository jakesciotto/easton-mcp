export interface DocsConfig {
  serviceAccountEmail: string
  privateKey: string
}

export function docsConfigFromEnv(env: Record<string, string | undefined>): DocsConfig | null {
  const serviceAccountEmail = env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim()
  const privateKey = env.GOOGLE_PRIVATE_KEY?.trim()
  if (!serviceAccountEmail || !privateKey) return null
  return { serviceAccountEmail, privateKey: privateKey.replace(/\\n/g, '\n') }
}
