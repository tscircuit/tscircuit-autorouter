import type { SimpleRouteConnection } from "lib/types"

export const getMinimumTraceWidthByConnectionName = (
  connections: readonly SimpleRouteConnection[],
): ReadonlyMap<string, number> => {
  const widths = new Map<string, number>()
  for (const connection of connections) {
    const width = connection.minTraceWidth
    if (width === undefined) continue
    if (!Number.isFinite(width) || width <= 0) {
      throw new Error(
        `Connection "${connection.name}" minimum trace width must be finite and positive`,
      )
    }
    const names = [
      connection.name,
      ...(connection.__rootConnectionNames ?? []),
      ...(connection.mergedConnectionNames ?? []),
      connection.rootConnectionName || undefined,
      connection.__netConnectionName,
    ]
    for (const name of names) {
      if (name === undefined) continue
      widths.set(name, Math.max(widths.get(name) ?? 0, width))
    }
  }
  return widths
}
