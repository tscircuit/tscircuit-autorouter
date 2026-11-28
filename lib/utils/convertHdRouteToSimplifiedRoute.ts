import { isExistingMultilayerObstacle } from "lib/utils/isExistingMultilayerObstacle"
import { distance, pointToBoxDistance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import {
  type ConnectionPoint,
  type Obstacle,
  type SimplifiedPcbTraces,
  type SingleLayerConnectionPoint,
  getConnectionPointLayers,
  isSingleLayerConnectionPoint,
} from "lib/types"
import { HighDensityIntraNodeRoute, Jumper } from "lib/types/high-density-types"
import { mapZToLayerName } from "./mapZToLayerName"

type Point = {
  x: number
  y: number
  z: number
  traceThickness?: number
  toNextSegmentType?: "through_obstacle"
  toNextSegmentCircuitJsonMetadata?: HighDensityIntraNodeRoute["route"][number]["toNextSegmentCircuitJsonMetadata"]
}
const DEFAULT_TERMINAL_VIA_ATTACH_TOLERANCE = 0.25
const SAME_POINT_TOLERANCE = 1e-12
const SAME_NET_OBSTACLE_TOLERANCE = 1e-6

export interface ConvertHdRouteToSimplifiedRouteOptions {
  connectionPoints?: ReadonlyArray<ConnectionPoint>
  terminalViaAttachTolerance?: number
  defaultViaHoleDiameter?: number
  obstacles?: ReadonlyArray<Obstacle>
  connectedMultilayerObstacles?: ReadonlyArray<Obstacle>
  connMap?: ConnectivityMap
}

/**
 * Extended HD route type that may contain jumpers (from HighDensitySolver)
 */
type HdRouteWithOptionalJumpers = HighDensityIntraNodeRoute & {
  jumpers?: Jumper[]
}

const areSameXyPoint = (
  a: Pick<Point, "x" | "y"> | undefined,
  b: Pick<Point, "x" | "y"> | undefined,
) =>
  !!a &&
  !!b &&
  Math.abs(a.x - b.x) <= SAME_POINT_TOLERANCE &&
  Math.abs(a.y - b.y) <= SAME_POINT_TOLERANCE

const pointInsideObstacle = (
  point: Pick<Point, "x" | "y">,
  obstacle: Obstacle,
): boolean => {
  if (obstacle.shape === "circle") {
    return distance(point, obstacle.center) <= obstacle.width / 2 + SAME_NET_OBSTACLE_TOLERANCE
  }
  return pointToBoxDistance(point, obstacle) <= SAME_NET_OBSTACLE_TOLERANCE
}

const isThroughObstacleSegment = (
  hdRoute: HdRouteWithOptionalJumpers,
  start: Point,
  end: Point,
  layerCount: number,
  opts: ConvertHdRouteToSimplifiedRouteOptions,
) => {
  if (start.toNextSegmentType === "through_obstacle") return true

  if (opts.connectedMultilayerObstacles) {
    return opts.connectedMultilayerObstacles.some(
      (obstacle) =>
        obstacle.layers.includes(mapZToLayerName(start.z, layerCount)) &&
        obstacle.layers.includes(mapZToLayerName(end.z, layerCount)) &&
        pointInsideObstacle(start, obstacle) &&
        pointInsideObstacle(end, obstacle),
    )
  }

  return (
    opts.obstacles?.some(
      (obstacle) =>
        isExistingMultilayerObstacle(obstacle) &&
        obstacle.layers.includes(mapZToLayerName(start.z, layerCount)) &&
        obstacle.layers.includes(mapZToLayerName(end.z, layerCount)) &&
        pointInsideObstacle(start, obstacle) &&
        pointInsideObstacle(end, obstacle) &&
        isObstacleConnectedToRoute(obstacle, hdRoute, opts.connMap),
    ) ?? false
  )
}

const findNearestTerminalViaPoint = ({
  endpoint,
  endpointLayer,
  connectionPoints,
  tolerance,
}: {
  endpoint: Point
  endpointLayer: string
  connectionPoints: ReadonlyArray<ConnectionPoint>
  tolerance: number
}): SingleLayerConnectionPoint | undefined => {
  let nearestTerminalViaPoint:
    | { point: SingleLayerConnectionPoint; distance: number }
    | undefined

  for (const point of connectionPoints) {
    if (!isSingleLayerConnectionPoint(point) || !point.terminalVia) continue
    if (point.layer !== endpointLayer) continue

    const endpointDistance = distance(point, endpoint)
    if (endpointDistance > tolerance) continue

    if (
      !nearestTerminalViaPoint ||
      endpointDistance < nearestTerminalViaPoint.distance
    ) {
      nearestTerminalViaPoint = { point, distance: endpointDistance }
    }
  }

  return nearestTerminalViaPoint?.point
}

const attachTerminalViasToSimplifiedRoute = ({
  route,
  hdRoute,
  layerCount,
  connectionPoints = [],
  tolerance = DEFAULT_TERMINAL_VIA_ATTACH_TOLERANCE,
  defaultViaHoleDiameter,
}: {
  route: SimplifiedPcbTraces[number]["route"]
  hdRoute: HdRouteWithOptionalJumpers
  layerCount: number
  connectionPoints?: ReadonlyArray<ConnectionPoint>
  tolerance?: number
  defaultViaHoleDiameter?: number
}): SimplifiedPcbTraces[number]["route"] => {
  if (
    route.length === 0 ||
    hdRoute.route.length === 0 ||
    !connectionPoints.length
  ) {
    return route
  }
  if (
    !connectionPoints.some(
      (point) => isSingleLayerConnectionPoint(point) && point.terminalVia,
    )
  ) {
    return route
  }

  const linearRoute = route.filter(
    (segment) => segment.route_type !== "jumper",
  ) as SimplifiedPcbTraces[number]["route"]
  const jumpers = route.filter(
    (segment) => segment.route_type === "jumper",
  ) as SimplifiedPcbTraces[number]["route"]

  if (linearRoute.length === 0) {
    return route
  }

  const startPoint = hdRoute.route[0]!
  const endPoint = hdRoute.route[hdRoute.route.length - 1]!
  const startLayer = mapZToLayerName(startPoint.z, layerCount)
  const endLayer = mapZToLayerName(endPoint.z, layerCount)
  const startTerminalViaPoint = findNearestTerminalViaPoint({
    endpoint: startPoint,
    endpointLayer: startLayer,
    connectionPoints,
    tolerance,
  })
  const endTerminalViaPoint = findNearestTerminalViaPoint({
    endpoint: endPoint,
    endpointLayer: endLayer,
    connectionPoints,
    tolerance,
  })

  const prependSegments: SimplifiedPcbTraces[number]["route"] = []
  const appendSegments: SimplifiedPcbTraces[number]["route"] = []
  const firstLinearRouteSegment = linearRoute[0]
  const lastLinearRouteSegment = linearRoute[linearRoute.length - 1]
  const startTraceThickness =
    startPoint.traceThickness ?? hdRoute.traceThickness
  const endTraceThickness = endPoint.traceThickness ?? hdRoute.traceThickness

  if (startTerminalViaPoint?.terminalVia) {
    prependSegments.push({
      route_type: "via",
      x: startTerminalViaPoint.x,
      y: startTerminalViaPoint.y,
      from_layer: startTerminalViaPoint.layer,
      to_layer: startTerminalViaPoint.terminalVia.toLayer,
      via_diameter:
        startTerminalViaPoint.terminalVia.viaDiameter ?? hdRoute.viaDiameter,
      ...(defaultViaHoleDiameter !== undefined
        ? { via_hole_diameter: defaultViaHoleDiameter }
        : {}),
    })

    if (
      !(
        firstLinearRouteSegment?.route_type === "wire" &&
        firstLinearRouteSegment.layer === startTerminalViaPoint.layer &&
        areSameXyPoint(firstLinearRouteSegment, startTerminalViaPoint)
      )
    ) {
      prependSegments.push({
        route_type: "wire",
        x: startTerminalViaPoint.x,
        y: startTerminalViaPoint.y,
        width: startTraceThickness,
        layer: startTerminalViaPoint.layer,
      })
    }
  }

  if (endTerminalViaPoint?.terminalVia) {
    if (
      !(
        lastLinearRouteSegment?.route_type === "wire" &&
        lastLinearRouteSegment.layer === endTerminalViaPoint.layer &&
        areSameXyPoint(lastLinearRouteSegment, endTerminalViaPoint)
      )
    ) {
      appendSegments.push({
        route_type: "wire",
        x: endTerminalViaPoint.x,
        y: endTerminalViaPoint.y,
        width: endTraceThickness,
        layer: endTerminalViaPoint.layer,
      })
    }

    appendSegments.push({
      route_type: "via",
      x: endTerminalViaPoint.x,
      y: endTerminalViaPoint.y,
      from_layer: endTerminalViaPoint.layer,
      to_layer: endTerminalViaPoint.terminalVia.toLayer,
      via_diameter:
        endTerminalViaPoint.terminalVia.viaDiameter ?? hdRoute.viaDiameter,
      ...(defaultViaHoleDiameter !== undefined
        ? { via_hole_diameter: defaultViaHoleDiameter }
        : {}),
    })
  }

  return [...prependSegments, ...linearRoute, ...appendSegments, ...jumpers]
}

/** Records existing terminal copper in board-world mm (+X right, +Y up),
 * without requesting another drill at that position. */
const attachExistingTerminalViaTransitions = ({
  route,
  connectionPoints,
  obstacles,
}: {
  route: SimplifiedPcbTraces[number]["route"]
  connectionPoints: ReadonlyArray<ConnectionPoint>
  obstacles: ReadonlyArray<Obstacle>
}): SimplifiedPcbTraces[number]["route"] => {
  const prepend: SimplifiedPcbTraces[number]["route"] = []
  const append: SimplifiedPcbTraces[number]["route"] = []
  for (const side of ["start", "end"] as const) {
    const endpoint = side === "start" ? route[0] : route.at(-1)
    if (endpoint?.route_type !== "wire") continue
    const terminal = connectionPoints.find(
      (point) =>
        point.pcb_port_id && point.x === endpoint.x && point.y === endpoint.y,
    )
    if (!terminal?.pcb_port_id) continue
    const terminalLayer = getConnectionPointLayers(terminal)[0]!
    if (terminalLayer === endpoint.layer) continue
    const existingVia = obstacles.find(
      (obstacle) =>
        obstacle.circuitJsonMetadata?.pcb_via_id &&
        !obstacle.netIsAssignable &&
        obstacle.center.x === endpoint.x &&
        obstacle.center.y === endpoint.y &&
        obstacle.layers.includes(endpoint.layer) &&
        obstacle.connectedTo.includes(terminal.pcb_port_id!),
    )
    if (!existingVia) continue
    const transition = {
      route_type: "through_obstacle" as const,
      start: { x: endpoint.x, y: endpoint.y },
      end: { x: endpoint.x, y: endpoint.y },
      from_layer: side === "start" ? terminalLayer : endpoint.layer,
      to_layer: side === "start" ? endpoint.layer : terminalLayer,
      width: endpoint.width,
      circuitJsonMetadata: existingVia.circuitJsonMetadata,
    }
    const terminalWire = {
      route_type: "wire" as const,
      x: endpoint.x,
      y: endpoint.y,
      width: endpoint.width,
      layer: terminalLayer,
    }
    if (side === "start") prepend.push(terminalWire, transition)
    else append.push(transition, terminalWire)
  }
  return [...prepend, ...route, ...append]
}

/** Keep a terminal on its actual wire approach; the existing barrel carries
 * the connection through its other layers without extra zero-length tails. */
const trimExistingTerminalTransitions = (
  route: SimplifiedPcbTraces[number]["route"],
  hdRoute: HdRouteWithOptionalJumpers,
  opts: ConvertHdRouteToSimplifiedRouteOptions,
): SimplifiedPcbTraces[number]["route"] => {
  const copper = opts.connectedMultilayerObstacles ?? opts.obstacles?.filter(
    (obstacle) => isExistingMultilayerObstacle(obstacle) &&
      isObstacleConnectedToRoute(obstacle, hdRoute, opts.connMap),
  ) ?? []
  let result = route
  for (const side of ["start", "end"] as const) {
    const direction = side === "start" ? 1 : -1
    const endpointIndex = side === "start" ? 0 : result.length - 1
    const endpoint = result[endpointIndex]
    if (endpoint?.route_type !== "wire") continue
    let selectedIndex = endpointIndex
    for (const obstacle of copper) {
      if (!obstacle.layers.includes(endpoint.layer) || !pointInsideObstacle(endpoint, obstacle)) continue
      let index = endpointIndex
      let layer = endpoint.layer
      let crossedBarrel = false
      while (index + direction >= 0 && index + direction < result.length) {
        const nextIndex = index + direction
        const point = result[nextIndex]!
        if (point.route_type === "wire") {
          if (point.layer !== layer) break
          if (!areSameXyPoint(point, endpoint)) {
            const approach = result[index]!
            const terminalAllowsLayer = !(opts.connectionPoints ?? []).some(
              (terminal) => terminal.pcb_port_id && areSameXyPoint(terminal, endpoint) &&
                !getConnectionPointLayers(terminal).includes(layer),
            )
            const width = side === "start" ? approach.route_type === "wire" ? approach.width : 0 : point.width
            if (approach.route_type === "wire" && Number.isFinite(width) && width > 0 &&
              crossedBarrel && terminalAllowsLayer &&
              Math.abs(index - endpointIndex) > Math.abs(selectedIndex - endpointIndex)) {
              selectedIndex = index
            }
            break
          }
        } else if (point.route_type === "through_obstacle") {
          const from = side === "start" ? point.from_layer : point.to_layer
          const to = side === "start" ? point.to_layer : point.from_layer
          if (from !== layer || !obstacle.layers.includes(to) ||
            !areSameXyPoint(point.start, endpoint) || !areSameXyPoint(point.end, endpoint)) break
          layer = to
          crossedBarrel = true
        } else {
          break
        }
        index = nextIndex
      }
    }
    result = side === "start" ? result.slice(selectedIndex) : result.slice(0, selectedIndex + 1)
  }
  return result
}

export const convertHdRouteToSimplifiedRoute = (
  hdRoute: HdRouteWithOptionalJumpers,
  layerCount: number,
  opts: ConvertHdRouteToSimplifiedRouteOptions = {},
): SimplifiedPcbTraces[number]["route"] => {
  const result: SimplifiedPcbTraces[number]["route"] = []
  if (hdRoute.route.length === 0) return result

  let currentLayerPoints: Point[] = []
  let currentZ = hdRoute.route[0].z

  // Add all points to their respective layer segments
  for (let i = 0; i < hdRoute.route.length; i++) {
    const point = hdRoute.route[i]

    // If we're changing layers, process the current layer's points
    // and add a via if one exists at this position
    if (point.z !== currentZ) {
      const previousPoint = currentLayerPoints[currentLayerPoints.length - 1]
      // Add all wire segments for the current layer
      const layerName = mapZToLayerName(currentZ, layerCount)
      for (const layerPoint of currentLayerPoints) {
        result.push({
          route_type: "wire",
          x: layerPoint.x,
          y: layerPoint.y,
          width: layerPoint.traceThickness ?? hdRoute.traceThickness,
          layer: layerName,
        })
      }

      const nextLayerName = mapZToLayerName(point.z, layerCount)
      if (
        previousPoint &&
        isThroughObstacleSegment(hdRoute, previousPoint, point, layerCount, opts)
      ) {
        result.push({
          route_type: "through_obstacle",
          start: { x: previousPoint.x, y: previousPoint.y },
          end: { x: point.x, y: point.y },
          from_layer: layerName,
          to_layer: nextLayerName,
          width: previousPoint.traceThickness ?? hdRoute.traceThickness,
          ...(previousPoint.toNextSegmentCircuitJsonMetadata
            ? {
                circuitJsonMetadata:
                  previousPoint.toNextSegmentCircuitJsonMetadata,
              }
            : {}),
        })
      } else {
        // Check if a via exists at this position
        const viaExists = hdRoute.vias.some(
          (via) =>
            Math.abs(via.x - point.x) < 0.001 &&
            Math.abs(via.y - point.y) < 0.001,
        )

        // Add a via if one exists
        if (viaExists) {
          result.push({
            route_type: "via",
            x: point.x,
            y: point.y,
            from_layer: layerName,
            to_layer: nextLayerName,
            via_diameter: hdRoute.viaDiameter,
            ...(opts.defaultViaHoleDiameter !== undefined
              ? { via_hole_diameter: opts.defaultViaHoleDiameter }
              : {}),
          })
        }
      }

      // Start a new layer
      currentLayerPoints = [point]
      currentZ = point.z
    } else {
      // Continue on the same layer
      if (
        !areSameXyPoint(
          currentLayerPoints[currentLayerPoints.length - 1],
          point,
        ) ||
        (currentLayerPoints.at(-1)?.traceThickness ?? hdRoute.traceThickness) !==
          (point.traceThickness ?? hdRoute.traceThickness)
      ) {
        currentLayerPoints.push(point)
      } else if (point.toNextSegmentType) {
        // The last duplicate carries the outgoing segment's copper transition.
        currentLayerPoints[currentLayerPoints.length - 1] = point
      }
    }
  }

  // Add the final layer's wire segments
  const layerName = mapZToLayerName(currentZ, layerCount)
  for (const layerPoint of currentLayerPoints) {
    result.push({
      route_type: "wire",
      x: layerPoint.x,
      y: layerPoint.y,
      width: layerPoint.traceThickness ?? hdRoute.traceThickness,
      layer: layerName,
    })
  }

  // Add jumpers if present
  if (hdRoute.jumpers && hdRoute.jumpers.length > 0) {
    const jumperLayerName = mapZToLayerName(
      hdRoute.route[0]?.z ?? 0,
      layerCount,
    )
    for (const jumper of hdRoute.jumpers) {
      result.push({
        route_type: "jumper",
        start: jumper.start,
        end: jumper.end,
        footprint: jumper.footprint,
        layer: jumperLayerName,
      })
    }
  }

  const routeWithTerminalVias = attachTerminalViasToSimplifiedRoute({
    route: result,
    hdRoute,
    layerCount,
    connectionPoints: opts.connectionPoints,
    tolerance: opts.terminalViaAttachTolerance,
    defaultViaHoleDiameter: opts.defaultViaHoleDiameter,
  })
  const routeWithExistingTerminals = attachExistingTerminalViaTransitions({
    route: routeWithTerminalVias,
    connectionPoints: opts.connectionPoints ?? [],
    obstacles: opts.connectedMultilayerObstacles ?? opts.obstacles ?? [],
  })
  return trimExistingTerminalTransitions(routeWithExistingTerminals, hdRoute, opts)
}
