import { distance, pointToBoxDistance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import {
  type ConnectionPoint,
  type Obstacle,
  type SimplifiedPcbTraces,
  type SingleLayerConnectionPoint,
  isSingleLayerConnectionPoint,
} from "lib/types"
import { HighDensityIntraNodeRoute, Jumper } from "lib/types/high-density-types"
import { mapZToLayerName } from "./mapZToLayerName"
import { mapLayerNameToZ } from "./mapLayerNameToZ"
import { routePointTouchesObstacleCopper } from "./routePointTouchesObstacleCopper"

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

const pointTouchesObstacle = (
  route: HdRouteWithOptionalJumpers,
  pointIndex: number,
  point: Pick<Point, "x" | "y">,
  obstacle: Obstacle,
) => obstacle.copperGeometry
  ? routePointTouchesObstacleCopper(route, pointIndex, obstacle)
  : pointToBoxDistance(point, obstacle) <= SAME_NET_OBSTACLE_TOLERANCE

const isMultilayerObstacle = (obstacle: Obstacle) =>
  (obstacle.__zLayers?.length ?? (obstacle.copperGeometry ? obstacle.zLayers?.length : undefined) ??
    obstacle.layers?.length ?? 0) > 1

const annotatedObstacleCoversTransition = (
  obstacle: Obstacle,
  start: Point,
  end: Point,
  layerCount: number,
) => {
  if (!obstacle.copperGeometry) return true
  const zLayers = obstacle.__zLayers ?? obstacle.zLayers ??
    obstacle.layers.map((layer) => mapLayerNameToZ(layer, layerCount))
  return zLayers.includes(start.z) && zLayers.includes(end.z)
}

const hasPhysicalCopperAnnotations = (opts: ConvertHdRouteToSimplifiedRouteOptions) =>
  opts.connectedMultilayerObstacles?.some((obstacle) => obstacle.copperGeometry) ||
  opts.obstacles?.some((obstacle) => obstacle.copperGeometry)

const isThroughObstacleSegment = (
  hdRoute: HdRouteWithOptionalJumpers,
  start: Point,
  end: Point,
  opts: ConvertHdRouteToSimplifiedRouteOptions,
  layerCount: number,
  startPointIndex: number,
  endPointIndex: number,
) => {
  if (start.toNextSegmentType === "through_obstacle" && !hasPhysicalCopperAnnotations(opts)) return true

  if (opts.connectedMultilayerObstacles) {
    return opts.connectedMultilayerObstacles.some(
      (obstacle) =>
        annotatedObstacleCoversTransition(obstacle, start, end, layerCount) &&
        pointTouchesObstacle(hdRoute, startPointIndex, start, obstacle) &&
        pointTouchesObstacle(hdRoute, endPointIndex, end, obstacle),
    )
  }

  return (
    opts.obstacles?.some(
      (obstacle) =>
        isMultilayerObstacle(obstacle) &&
        annotatedObstacleCoversTransition(obstacle, start, end, layerCount) &&
        pointTouchesObstacle(hdRoute, startPointIndex, start, obstacle) &&
        pointTouchesObstacle(hdRoute, endPointIndex, end, obstacle) &&
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
        isThroughObstacleSegment(hdRoute, previousPoint, point, opts, layerCount, i - 1, i)
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
        if (!viaExists && previousPoint?.toNextSegmentType === "through_obstacle" &&
            hasPhysicalCopperAnnotations(opts)) {
          throw new Error(`Physical route ${hdRoute.connectionName} has an invalid through-obstacle transition from ${currentZ} to ${point.z} without a via`)
        }

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
        )
      ) {
        currentLayerPoints.push(point)
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

  return attachTerminalViasToSimplifiedRoute({
    route: result,
    hdRoute,
    layerCount,
    connectionPoints: opts.connectionPoints,
    tolerance: opts.terminalViaAttachTolerance,
    defaultViaHoleDiameter: opts.defaultViaHoleDiameter,
  })
}
