/**
 * Reads Jev credentials from the environment variable the TypeSafe SDK
 * documents. Server-side only: nothing in the browser bundle imports this.
 */
export const apiKeyVariable = 'TYPESAFE_API_KEY'

export type JevConfig = { status: 'configured'; apiKey: string } | { status: 'missing_credentials' }

export function readJevConfig(env: Readonly<Record<string, string | undefined>>): JevConfig {
  const apiKey = env[apiKeyVariable]?.trim()
  return apiKey ? { status: 'configured', apiKey } : { status: 'missing_credentials' }
}
