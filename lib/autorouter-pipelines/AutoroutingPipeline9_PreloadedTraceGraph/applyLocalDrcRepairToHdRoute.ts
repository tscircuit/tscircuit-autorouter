import type { SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

type Params = {
  hdRoute: HighDensityRoute
  before: SimplifiedPcbTrace
  after: SimplifiedPcbTrace
  layerCount: number
}

/** Transfers coordinate-only repairs back to their HD owner without rebuilding metadata. */
export const applyLocalDrcRepairToHdRoute = ({
  hdRoute,
  before,
  after,
  layerCount,
}: Params): HighDensityRoute => {
  const oldWires = before.route.filter((point) => point.route_type === "wire")
  const newWires = after.route.filter((point) => point.route_type === "wire")
  if (oldWires.length !== newWires.length || before.route.length !== after.route.length) {
    throw new Error("Joint DRC local repair must preserve route point ordering")
  }
  let wireIndex = -1
  let lastEmittedPoint: HighDensityRoute["route"][number] | undefined
  const route = hdRoute.route.map((point) => {
    // The SRJ converter omits adjacent coincident points on one layer. Move
    // those original HD points together and retain their individual metadata.
    if (
      !lastEmittedPoint ||
      point.z !== lastEmittedPoint.z ||
      Math.abs(point.x - lastEmittedPoint.x) > 1e-12 ||
      Math.abs(point.y - lastEmittedPoint.y) > 1e-12
    ) {
      wireIndex++
      lastEmittedPoint = point
    }
    const oldWire = oldWires[wireIndex]
    const newWire = newWires[wireIndex]
    if (
      !oldWire || !newWire ||
      oldWire.layer !== mapZToLayerName(point.z, layerCount) ||
      Math.abs(oldWire.x - point.x) > 1e-12 ||
      Math.abs(oldWire.y - point.y) > 1e-12
    ) {
      throw new Error(`Joint DRC cannot map repaired wire to ${hdRoute.connectionName}`)
    }
    if (oldWire.x === newWire.x && oldWire.y === newWire.y) return point
    if (point.pcb_port_id) {
      throw new Error(`Joint DRC cannot move terminal ${point.pcb_port_id}`)
    }
    return { ...point, x: newWire.x, y: newWire.y }
  })
  if (wireIndex + 1 !== oldWires.length) {
    throw new Error(`Joint DRC left unmapped wires for ${hdRoute.connectionName}`)
  }
  const vias = hdRoute.vias.map((via) => {
    const destinations = before.route.flatMap((point, index) => {
      if (
        point.route_type !== "via" ||
        Math.abs(point.x - via.x) >= 0.001 ||
        Math.abs(point.y - via.y) >= 0.001
      ) return []
      const next = after.route[index]!
      if (next.route_type !== "via") {
        throw new Error("Joint DRC local repair changed a via's route type")
      }
      return [next]
    })
    if (destinations.length === 0) return via
    const target = destinations[0]!
    if (destinations.some((point) => point.x !== target.x || point.y !== target.y)) {
      throw new Error("Joint DRC local repair split one HD via into multiple sites")
    }
    return { ...via, x: target.x, y: target.y }
  })
  const repaired = { ...hdRoute, route, vias }
  // Compare physical emitted geometry as well as metadata-preserving HD state.
  // Via consolidation can make adjacent wire points coincide; serialization
  // legitimately removes those zero-length segments.
  const geometry = (points: SimplifiedPcbTrace["route"]): string => {
    const normalized: unknown[] = []
    let previous: SimplifiedPcbTrace["route"][number] | undefined
    for (const point of points) {
      if (
        point.route_type === "wire" && previous?.route_type === "wire" &&
        point.x === previous.x && point.y === previous.y &&
        point.layer === previous.layer && point.width === previous.width
      ) continue
      normalized.push(point.route_type === "wire"
        ? [point.route_type, point.x, point.y, point.layer, point.width]
        : point.route_type === "via"
          ? [point.route_type, point.x, point.y, point.from_layer, point.to_layer, point.via_diameter]
          : point)
      previous = point
    }
    return JSON.stringify(normalized)
  }
  if (geometry(convertHdRouteToSimplifiedRoute(repaired, layerCount)) !== geometry(after.route)) {
    throw new Error(`Joint DRC changed emitted geometry while mapping ${hdRoute.connectionName}`)
  }
  return repaired
}
