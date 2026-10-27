import { createHash } from "node:crypto"

const provenanceKeys = new Set([
  "id", "sourceCircuitJson", "sourceName", "sourceUrl", "sourceRepository",
  "sourceLicense", "sourceBoardFormat", "sourcePcbDocSha256", "snapshotComparison", "effort",
])

export const canonicalRoutingInput = (input: Record<string, unknown>): string => {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]))
    }
    return value
  }
  const routingFields = Object.fromEntries(Object.entries(input).filter(([key]) => !provenanceKeys.has(key)))
  return JSON.stringify(canonical(routingFields))
}

export const routingInputEvidence = (input: any): Record<string, unknown> => {
  const terminalIds = new Set(input.connections.flatMap((connection: any) => connection.pointsToConnect.map((point: any) => point.pcb_port_id).filter(Boolean)))
  const componentIds = new Set(input.obstacles.map((obstacle: any) => obstacle.componentId).filter(Boolean))
  return {
    routingFieldsCanonicalSha256: createHash("sha256").update(canonicalRoutingInput(input)).digest("hex"),
    netCount: input.connections.length,
    uniquePcbTerminalCount: terminalIds.size,
    obstacleComponentCount: componentIds.size,
    obstacleCount: input.obstacles.length,
    layerCount: input.layerCount,
    minTraceWidth: input.minTraceWidth,
    allowBlindAndBuriedVias: input.allowBlindAndBuriedVias,
  }
}
