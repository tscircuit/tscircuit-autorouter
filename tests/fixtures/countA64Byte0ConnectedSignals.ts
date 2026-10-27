import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

/** Each source point pair must be joined by continuous emitted wire/via copper. */
export function countA64Byte0ConnectedSignals({
  inputSrj,
  routedTraces,
}: {
  inputSrj: SimpleRouteJson
  routedTraces: SimplifiedPcbTrace[]
}): number {
  return inputSrj.connections.filter((connection) =>
    routedTraces.some((trace) => {
      if (trace.connection_name !== connection.name) return false
      const start = trace.route[0]
      const end = trace.route.at(-1)
      if (start?.route_type !== "wire" || end?.route_type !== "wire") {
        return false
      }
      const endpointsMatch = connection.pointsToConnect.every((terminal) =>
        [start, end].some(
          (point) =>
            terminal.layer === point.layer &&
            Math.hypot(point.x - terminal.x, point.y - terminal.y) < 1e-6,
        ),
      )
      if (!endpointsMatch) return false
      return trace.route.every((point, index) => {
        const next = trace.route[index + 1]
        if (next === undefined) return true
        if (point.route_type === "wire" && next.route_type === "wire") {
          return point.layer === next.layer
        }
        if (point.route_type === "wire" && next.route_type === "via") {
          return (
            point.layer === next.from_layer &&
            Math.hypot(point.x - next.x, point.y - next.y) < 1e-6
          )
        }
        if (point.route_type === "via" && next.route_type === "wire") {
          return (
            point.to_layer === next.layer &&
            Math.hypot(point.x - next.x, point.y - next.y) < 1e-6
          )
        }
        return false
      })
    }),
  ).length
}
