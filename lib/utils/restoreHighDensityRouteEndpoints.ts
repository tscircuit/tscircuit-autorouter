import type { HighDensityRoute } from "lib/types/high-density-types"

/** Reconnect independently adjusted regional routes at their exact shared ports. */
export function restoreHighDensityRouteEndpoints(
  originalRoutes: ReadonlyArray<HighDensityRoute>,
  adjustedRoutes: ReadonlyArray<HighDensityRoute>,
): HighDensityRoute[] {
  if (originalRoutes.length !== adjustedRoutes.length) {
    throw new Error("Endpoint restoration requires the same regional route set")
  }
  return adjustedRoutes.map((adjusted, index) => {
    const original = originalRoutes[index]
    const start = original.route[0]
    const end = original.route.at(-1)
    const adjustedStart = adjusted.route[0]
    const adjustedEnd = adjusted.route.at(-1)
    if (original.connectionName !== adjusted.connectionName || original.regionId !== adjusted.regionId ||
      !start || !end || !adjustedStart || !adjustedEnd ||
      start.z !== adjustedStart.z || end.z !== adjustedEnd.z) {
      throw new Error(`Endpoint restoration found incompatible regional route ${index}`)
    }
    const points = adjusted.route.map(point => ({ ...point }))
    // Add same-layer copper instead of moving an adjusted via or losing its metadata.
    if (start.x !== adjustedStart.x || start.y !== adjustedStart.y) {
      const connector = { ...start }
      delete connector.toNextSegmentType
      delete connector.toNextSegmentCircuitJsonMetadata
      points.unshift(connector)
    }
    if (end.x !== adjustedEnd.x || end.y !== adjustedEnd.y) {
      points.push({ ...end })
    }
    return { ...adjusted, route: points }
  })
}
