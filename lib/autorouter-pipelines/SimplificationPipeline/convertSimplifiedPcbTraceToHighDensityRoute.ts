import type { SimplifiedPcbTrace } from "lib/types"
import type {
  HighDensityRoute,
  Jumper,
} from "lib/types/high-density-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

type RoutePoint = HighDensityRoute["route"][number]
type SimplifiedRoutePoint = SimplifiedPcbTrace["route"][number]

const SAME_POINT_TOLERANCE = 1e-9

const pointsMatch = (left: RoutePoint, right: RoutePoint): boolean =>
  Math.abs(left.x - right.x) <= SAME_POINT_TOLERANCE &&
  Math.abs(left.y - right.y) <= SAME_POINT_TOLERANCE &&
  left.z === right.z

const appendRoutePoint = (
  route: RoutePoint[],
  point: RoutePoint,
): void => {
  const previousPoint = route.at(-1)
  if (previousPoint && pointsMatch(previousPoint, point)) {
    if (point.traceThickness !== undefined) {
      previousPoint.traceThickness = point.traceThickness
    }
    if (point.pcb_port_id !== undefined) {
      previousPoint.pcb_port_id = point.pcb_port_id
    }
    return
  }
  route.push(point)
}

const getNextWireLayer = (
  simplifiedRoute: SimplifiedPcbTrace["route"],
  pointIndex: number,
  layerCount: number,
): number | undefined => {
  for (let index = pointIndex + 1; index < simplifiedRoute.length; index++) {
    const point = simplifiedRoute[index]!
    if (point.route_type === "wire") {
      return mapLayerNameToZ(point.layer, layerCount)
    }
    if (point.route_type === "through_obstacle") {
      return mapLayerNameToZ(point.from_layer, layerCount)
    }
  }
  return undefined
}

const orientLayerTransition = ({
  fromZ,
  toZ,
  previousZ,
  nextZ,
}: {
  fromZ: number
  toZ: number
  previousZ?: number
  nextZ?: number
}): [number, number] => {
  if (previousZ === fromZ) return [fromZ, toZ]
  if (previousZ === toZ) return [toZ, fromZ]
  if (nextZ === toZ) return [fromZ, toZ]
  if (nextZ === fromZ) return [toZ, fromZ]
  return [fromZ, toZ]
}

const getTraceThickness = (
  simplifiedRoute: SimplifiedPcbTrace["route"],
  defaultTraceThickness: number,
): number => {
  for (const point of simplifiedRoute) {
    if (point.route_type === "wire" || point.route_type === "through_obstacle") {
      return point.width
    }
  }
  return defaultTraceThickness
}

const getViaDiameter = (
  simplifiedRoute: SimplifiedPcbTrace["route"],
  defaultViaDiameter: number,
): number => {
  for (const point of simplifiedRoute) {
    if (point.route_type === "via" && point.via_diameter !== undefined) {
      return point.via_diameter
    }
  }
  return defaultViaDiameter
}

const getTerminalPcbPortId = (
  simplifiedRoute: SimplifiedPcbTrace["route"],
  terminal: "start" | "end",
): string | undefined => {
  const route =
    terminal === "start" ? simplifiedRoute : [...simplifiedRoute].reverse()
  for (const point of route) {
    if (point.route_type !== "wire") continue
    const pcbPortId = terminal === "start"
      ? point.start_pcb_port_id
      : point.end_pcb_port_id
    if (pcbPortId) return pcbPortId
  }
  return undefined
}

const convertJumper = (
  point: Extract<SimplifiedRoutePoint, { route_type: "jumper" }>,
): Jumper => ({
  route_type: "jumper",
  start: { ...point.start },
  end: { ...point.end },
  footprint: point.footprint,
})

export interface ConvertSimplifiedPcbTraceToHighDensityRouteOptions {
  layerCount: number
  defaultTraceThickness: number
  defaultViaDiameter: number
  rootConnectionName: string
}

/** Converts an existing simplified trace into the route form used by cleanup solvers. */
export const convertSimplifiedPcbTraceToHighDensityRoute = (
  trace: SimplifiedPcbTrace,
  options: ConvertSimplifiedPcbTraceToHighDensityRouteOptions,
): HighDensityRoute => {
  const route: RoutePoint[] = []
  const vias: Array<{ x: number; y: number }> = []
  const jumpers: Jumper[] = []
  const traceThickness = getTraceThickness(
    trace.route,
    options.defaultTraceThickness,
  )

  for (let pointIndex = 0; pointIndex < trace.route.length; pointIndex++) {
    const point = trace.route[pointIndex]!
    if (point.route_type === "jumper") {
      jumpers.push(convertJumper(point))
      continue
    }

    if (point.route_type === "wire") {
      appendRoutePoint(route, {
        x: point.x,
        y: point.y,
        z: mapLayerNameToZ(point.layer, options.layerCount),
        traceThickness: point.width,
        pcb_port_id: point.start_pcb_port_id ?? point.end_pcb_port_id,
      })
      continue
    }

    const fromZ = mapLayerNameToZ(point.from_layer, options.layerCount)
    const toZ = mapLayerNameToZ(point.to_layer, options.layerCount)
    const [startZ, endZ] = orientLayerTransition({
      fromZ,
      toZ,
      previousZ: route.at(-1)?.z,
      nextZ: getNextWireLayer(trace.route, pointIndex, options.layerCount),
    })

    if (point.route_type === "via") {
      appendRoutePoint(route, {
        x: point.x,
        y: point.y,
        z: startZ,
        traceThickness,
      })
      appendRoutePoint(route, {
        x: point.x,
        y: point.y,
        z: endZ,
        traceThickness,
      })
      vias.push({ x: point.x, y: point.y })
      continue
    }

    const transitionFollowsInputDirection = startZ === fromZ
    const start = transitionFollowsInputDirection ? point.start : point.end
    const end = transitionFollowsInputDirection ? point.end : point.start
    appendRoutePoint(route, {
      ...start,
      z: startZ,
      traceThickness: point.width,
      toNextSegmentType: "through_obstacle",
      ...(point.circuitJsonMetadata
        ? { toNextSegmentCircuitJsonMetadata: point.circuitJsonMetadata }
        : {}),
    })
    appendRoutePoint(route, {
      ...end,
      z: endZ,
      traceThickness: point.width,
    })
  }

  return {
    connectionName: trace.pcb_trace_id,
    rootConnectionName: options.rootConnectionName,
    startPcbPortId: getTerminalPcbPortId(trace.route, "start"),
    endPcbPortId: getTerminalPcbPortId(trace.route, "end"),
    traceThickness,
    viaDiameter: getViaDiameter(trace.route, options.defaultViaDiameter),
    route,
    vias,
    ...(jumpers.length > 0 ? { jumpers } : {}),
  }
}
