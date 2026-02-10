import type { SimpleRouteConnection } from "../types"

/**
 * Creates a map from connection names to their nominal trace widths.
 * This is used by high-density solvers to assign appropriate trace thickness
 * to each route based on the connection specification.
 *
 * @param connections - Array of connections with optional nominalTraceWidth
 * @param defaultWidth - Fallback width if connection doesn't specify one
 * @returns Map from connection name (and root connection name) to trace width
 */
export function getConnectionTraceWidthMap(
  connections: SimpleRouteConnection[],
  defaultWidth: number,
): Map<string, number> {
  const widthMap = new Map<string, number>()

  for (const conn of connections) {
    const width = conn.nominalTraceWidth ?? defaultWidth

    // Map both the connection name and root connection name
    widthMap.set(conn.name, width)
    if (conn.rootConnectionName) {
      widthMap.set(conn.rootConnectionName, width)
    }
  }

  return widthMap
}
