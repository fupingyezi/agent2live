const STRIPPED_VARIABLES = new Set(['PSD2LIVE_MCP_TOKEN', 'PSD2LIVE_MCP_URL'])

/**
 * Builds the environment for the third-party Gradle process. MCP credentials
 * belong to the probe process only and must never leak into the PSD2Live build.
 */
export function buildGradleEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || STRIPPED_VARIABLES.has(key)) continue
    env[key] = value
  }
  return env
}
