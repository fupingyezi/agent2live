export function isAllowedProbeCommand(command: string, allowed: ReadonlySet<string>): boolean {
  return allowed.has(command.trim())
}
