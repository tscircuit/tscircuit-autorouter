import {
  HighDensitySolverB01,
  type HighDensityObstacle,
  type HighDensityRectObstacle,
  type HighDensityRouteObstacle,
  type NodeWithPortPoints,
} from "@tscircuit/high-density-b01"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import type { Obstacle, SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

type Pipeline9B01RerouterParams = {
  srj: SimpleRouteJson
  baseObstacles: Obstacle[]
  connMap?: ConnectivityMap
}

export type Pipeline9B01RerouteOptions = {
  routeIndex: number
  startIndex?: number
  endIndex?: number
  /**
   * Candidate routes that are intentionally absent while a related cluster
   * is rebuilt. Fixed/preloaded copper is never omitted.
   */
  omitCandidateRouteIndexes?: ReadonlySet<number>
  includeCandidateCopper: boolean
  reverse: boolean
  shortenPath: boolean
  maxIterations: number
}

export type Pipeline9B01RerouteResult = {
  route?: HighDensityRoute
  iterations: number
}

export type Pipeline9TerminalViaEscapeCandidate = {
  alternateZ: number
  startVia: { x: number; y: number }
  endVia: { x: number; y: number }
}

export type Pipeline9TerminalViaEscapeOptions = Omit<
  Pipeline9B01RerouteOptions,
  "startIndex" | "endIndex"
> & {
  candidate: Pipeline9TerminalViaEscapeCandidate
}

const SAME_POINT_EPSILON = 1e-9
const B01_TRACE_CLEARANCE = 0.1
const B01_GRID_STEP = 0.05
const B01_LOW_RESOLUTION_CELL_SIZE = 0.2
const MAX_B01_ROUTING_WINDOW_SIZE = 15
const MAX_TERMINAL_VIA_ESCAPE_CANDIDATES = 64
const RELAXED_VIA_TRACE_CLEARANCE = 0.1

const pointsAreEqual = (
  left: HighDensityRoute["route"][number] | undefined,
  right: HighDensityRoute["route"][number],
): boolean =>
  Boolean(left) &&
  Math.abs(left!.x - right.x) <= SAME_POINT_EPSILON &&
  Math.abs(left!.y - right.y) <= SAME_POINT_EPSILON &&
  left!.z === right.z

const addCanonicalConnectivity = (
  obstacle: Obstacle,
  connMap?: ConnectivityMap,
): Obstacle => {
  if (!connMap) return obstacle

  const connectedTo = new Set(obstacle.connectedTo)
  for (const connectionId of obstacle.connectedTo) {
    const netId = connMap.getNetConnectedToId(connectionId)
    if (netId) connectedTo.add(netId)
  }
  return { ...obstacle, connectedTo: [...connectedTo] }
}

const getCanonicalRootConnectionName = (
  connectionName: string,
  connMap?: ConnectivityMap,
): string =>
  connMap?.getNetConnectedToId(connectionName) ??
  connectionName.replace(/_mst\d+$/, "")

const convertRectObstacle = (
  obstacle: Obstacle,
  obstacleIndex: number,
  layerCount: number,
  connMap?: ConnectivityMap,
): HighDensityRectObstacle => {
  const connectionName =
    obstacle.obstacleId ?? `pipeline9_base_obstacle_${obstacleIndex}`
  const rootConnectionName =
    obstacle.connectedTo
      .map((connectedId) => connMap?.getNetConnectedToId(connectedId))
      .find((netId): netId is string => Boolean(netId)) ?? connectionName
  return {
    type: "rect",
    connectionName,
    rootConnectionName,
    center: obstacle.center,
    width: obstacle.width,
    height: obstacle.height,
    ccwRotationDegrees: obstacle.ccwRotationDegrees,
    zLayers:
      obstacle.__zLayers ??
      obstacle.layers.map((layer) => mapLayerNameToZ(layer, layerCount)),
  }
}

const getRouteVias = (
  route: HighDensityRoute["route"],
): Array<{ x: number; y: number }> => {
  const vias: Array<{ x: number; y: number }> = []
  const seen = new Set<string>()
  for (let pointIndex = 1; pointIndex < route.length; pointIndex += 1) {
    const previous = route[pointIndex - 1]!
    const point = route[pointIndex]!
    if (previous.z === point.z) continue
    const key = `${point.x.toFixed(9)}:${point.y.toFixed(9)}`
    if (seen.has(key)) continue
    seen.add(key)
    vias.push({ x: point.x, y: point.y })
  }
  return vias
}

const convertCandidateRouteToObstacle = (
  route: HighDensityRoute,
  connMap?: ConnectivityMap,
): HighDensityRouteObstacle => ({
  type: "route",
  connectionName: route.connectionName,
  rootConnectionName:
    connMap?.getNetConnectedToId(route.connectionName) ??
    route.rootConnectionName ??
    route.connectionName.replace(/_mst\d+$/, ""),
  traceThickness: route.traceThickness,
  viaDiameter: route.viaDiameter,
  route: route.route.map(({ x, y, z }) => ({ x, y, z })),
  vias: getRouteVias(route.route),
})

export const convertPreloadedTraceToRouteObstacles = (
  trace: SimplifiedPcbTrace,
  traceIndex: number,
  layerCount: number,
  defaultViaDiameter: number,
  connMap?: ConnectivityMap,
): HighDensityRouteObstacle[] => {
  const connectionName = trace.connection_name
  const rootConnectionName = getCanonicalRootConnectionName(
    connectionName,
    connMap,
  )
  const obstacles: HighDensityRouteObstacle[] = []
  const addObstacle = (
    route: HighDensityRouteObstacle["route"],
    traceThickness: number,
    viaDiameter = defaultViaDiameter,
    vias: Array<{ x: number; y: number }> = [],
  ): void => {
    if (route.length < 2) return
    obstacles.push({
      type: "route",
      connectionName: `${connectionName}_fixed_${traceIndex}_${obstacles.length}`,
      rootConnectionName,
      traceThickness: Math.max(SAME_POINT_EPSILON, traceThickness),
      viaDiameter: Math.max(SAME_POINT_EPSILON, viaDiameter),
      route,
      vias,
    })
  }

  for (let pointIndex = 0; pointIndex < trace.route.length; pointIndex += 1) {
    const point = trace.route[pointIndex]!
    if (point.route_type === "via") {
      const fromZ = mapLayerNameToZ(point.from_layer, layerCount)
      const toZ = mapLayerNameToZ(point.to_layer, layerCount)
      addObstacle(
        [
          { x: point.x, y: point.y, z: fromZ },
          { x: point.x, y: point.y, z: toZ },
        ],
        SAME_POINT_EPSILON,
        point.via_diameter ?? defaultViaDiameter,
        [{ x: point.x, y: point.y }],
      )
      continue
    }
    if (point.route_type === "through_obstacle") {
      const fromZ = mapLayerNameToZ(point.from_layer, layerCount)
      const toZ = mapLayerNameToZ(point.to_layer, layerCount)
      const minZ = Math.min(fromZ, toZ)
      const maxZ = Math.max(fromZ, toZ)
      for (let z = minZ; z <= maxZ; z += 1) {
        addObstacle(
          [
            { ...point.start, z },
            { ...point.end, z },
          ],
          point.width,
        )
      }
      continue
    }

    const next = trace.route[pointIndex + 1]
    if (
      point.route_type !== "wire" ||
      next?.route_type !== "wire" ||
      point.layer !== next.layer
    ) {
      continue
    }
    const z = mapLayerNameToZ(point.layer, layerCount)
    addObstacle(
      [
        { x: point.x, y: point.y, z },
        { x: next.x, y: next.y, z },
      ],
      Math.max(point.width, next.width),
    )
  }

  return obstacles
}

const simplifyB01Route = (
  route: HighDensityRoute["route"],
): HighDensityRoute["route"] => {
  const deduplicated = route.filter(
    (point, pointIndex, allPoints) =>
      !pointsAreEqual(allPoints[pointIndex - 1], point),
  )
  if (deduplicated.length < 3) return deduplicated

  const simplified = [deduplicated[0]!]
  for (let pointIndex = 1; pointIndex < deduplicated.length - 1; pointIndex++) {
    const previous = simplified.at(-1)!
    const point = deduplicated[pointIndex]!
    const next = deduplicated[pointIndex + 1]!
    const crossProduct =
      (point.x - previous.x) * (next.y - point.y) -
      (point.y - previous.y) * (next.x - point.x)
    if (
      previous.z === point.z &&
      point.z === next.z &&
      Math.abs(crossProduct) <= SAME_POINT_EPSILON
    ) {
      continue
    }
    simplified.push(point)
  }
  simplified.push(deduplicated.at(-1)!)
  return simplified
}

const normalizeEndpointLayerTransitions = (
  route: HighDensityRoute["route"],
): HighDensityRoute["route"] => {
  if (route.length < 2) return route
  const normalized = [...route]
  const start = normalized[0]!
  const next = normalized[1]!
  if (
    start.z !== next.z &&
    Math.hypot(start.x - next.x, start.y - next.y) > SAME_POINT_EPSILON
  ) {
    normalized.splice(1, 0, {
      x: start.x,
      y: start.y,
      z: next.z,
      traceThickness: start.traceThickness,
    })
  }

  const end = normalized.at(-1)!
  const previous = normalized.at(-2)!
  if (
    previous.z !== end.z &&
    Math.hypot(previous.x - end.x, previous.y - end.y) > SAME_POINT_EPSILON
  ) {
    normalized.splice(normalized.length - 1, 0, {
      x: end.x,
      y: end.y,
      z: previous.z,
      traceThickness: end.traceThickness,
    })
  }
  return normalized
}

const getB01RoutingWindow = (
  startPoint: HighDensityRoute["route"][number],
  endPoint: HighDensityRoute["route"][number],
  boardBounds: SimpleRouteJson["bounds"],
):
  | {
      center: { x: number; y: number }
      width: number
      height: number
    }
  | undefined => {
  const getAxisWindow = (
    start: number,
    end: number,
    boardMin: number,
    boardMax: number,
  ): { min: number; max: number } | undefined => {
    const endpointMin = Math.min(start, end)
    const endpointMax = Math.max(start, end)
    const endpointSpan = endpointMax - endpointMin
    if (endpointSpan > MAX_B01_ROUTING_WINDOW_SIZE) return undefined

    const boardSize = boardMax - boardMin
    if (boardSize <= 0) return undefined
    const size = Math.min(boardSize, MAX_B01_ROUTING_WINDOW_SIZE)
    let min = (start + end) / 2 - size / 2
    let max = min + size
    if (min < boardMin) {
      min = boardMin
      max = min + size
    }
    if (max > boardMax) {
      max = boardMax
      min = max - size
    }
    if (
      endpointMin < min - SAME_POINT_EPSILON ||
      endpointMax > max + SAME_POINT_EPSILON
    ) {
      return undefined
    }
    return { min, max }
  }

  const xWindow = getAxisWindow(
    startPoint.x,
    endPoint.x,
    boardBounds.minX,
    boardBounds.maxX,
  )
  const yWindow = getAxisWindow(
    startPoint.y,
    endPoint.y,
    boardBounds.minY,
    boardBounds.maxY,
  )
  if (!xWindow || !yWindow) return undefined

  return {
    center: {
      x: (xWindow.min + xWindow.max) / 2,
      y: (yWindow.min + yWindow.max) / 2,
    },
    width: xWindow.max - xWindow.min,
    height: yWindow.max - yWindow.min,
  }
}

const routeStaysInsideBounds = (
  points: HighDensityRoute["route"],
  route: HighDensityRoute,
  bounds: SimpleRouteJson["bounds"],
): boolean =>
  points.every((point, pointIndex) => {
    const isTerminal = pointIndex === 0 || pointIndex === points.length - 1
    const previous = points[pointIndex - 1]
    const next = points[pointIndex + 1]
    const isVia =
      (previous?.z !== undefined && previous.z !== point.z) ||
      (next?.z !== undefined && next.z !== point.z)
    const inset = isTerminal
      ? 0
      : isVia
        ? route.viaDiameter / 2
        : route.traceThickness / 2

    return (
      point.x >= bounds.minX + inset - SAME_POINT_EPSILON &&
      point.x <= bounds.maxX - inset + SAME_POINT_EPSILON &&
      point.y >= bounds.minY + inset - SAME_POINT_EPSILON &&
      point.y <= bounds.maxY - inset + SAME_POINT_EPSILON
    )
  })

const obstacleAppliesToLayer = (
  obstacle: Obstacle,
  z: number,
  layerCount: number,
): boolean =>
  obstacle.__zLayers?.includes(z) === true ||
  obstacle.layers.includes(mapZToLayerName(z, layerCount))

const pointIsInsideObstacle = (
  point: { x: number; y: number },
  obstacle: Obstacle,
): boolean => {
  const radians = -((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const deltaX = point.x - obstacle.center.x
  const deltaY = point.y - obstacle.center.y
  const localX = deltaX * Math.cos(radians) - deltaY * Math.sin(radians)
  const localY = deltaX * Math.sin(radians) + deltaY * Math.cos(radians)

  return (
    Math.abs(localX) <= obstacle.width / 2 + SAME_POINT_EPSILON &&
    Math.abs(localY) <= obstacle.height / 2 + SAME_POINT_EPSILON
  )
}

const pointFitsInsideBounds = (
  point: { x: number; y: number },
  bounds: SimpleRouteJson["bounds"],
  inset: number,
): boolean =>
  point.x >= bounds.minX + inset - SAME_POINT_EPSILON &&
  point.x <= bounds.maxX - inset + SAME_POINT_EPSILON &&
  point.y >= bounds.minY + inset - SAME_POINT_EPSILON &&
  point.y <= bounds.maxY - inset + SAME_POINT_EPSILON

const obstacleRepresentsPhysicalPad = (obstacle: Obstacle): boolean =>
  obstacle.connectedTo.some(
    (id) => id.startsWith("pcb_smtpad_") || id.startsWith("pcb_plated_hole_"),
  )

const snapToB01Grid = (value: number): number => {
  const snapped = Math.round(value / B01_GRID_STEP) * B01_GRID_STEP
  return Math.abs(snapped) <= SAME_POINT_EPSILON ? 0 : snapped
}

const getPointKey = (point: { x: number; y: number }): string =>
  `${point.x.toFixed(9)}:${point.y.toFixed(9)}`

export class Pipeline9B01Rerouter {
  private readonly srj: SimpleRouteJson
  private readonly connMap?: ConnectivityMap
  private readonly terminalObstacles: Obstacle[]
  private readonly fixedObstacles: HighDensityObstacle[]
  private readonly preloadedObstaclesByTraceId = new Map<
    string,
    HighDensityRouteObstacle[]
  >()
  private readonly candidateObstacleCache = new WeakMap<
    HighDensityRoute[],
    Map<string, HighDensityRouteObstacle[]>
  >()

  constructor(params: Pipeline9B01RerouterParams) {
    this.srj = params.srj
    this.connMap = params.connMap
    this.terminalObstacles = params.baseObstacles.map((obstacle) =>
      addCanonicalConnectivity(obstacle, params.connMap),
    )
    const defaultViaDiameter =
      params.srj.minViaPadDiameter ??
      params.srj.min_via_pad_diameter ??
      params.srj.minViaDiameter ??
      0.3
    const preloadedTraceObstacles = (params.srj.traces ?? []).flatMap(
      (trace, traceIndex) => {
        const obstacles = convertPreloadedTraceToRouteObstacles(
          trace,
          traceIndex,
          params.srj.layerCount,
          defaultViaDiameter,
          params.connMap,
        )
        this.preloadedObstaclesByTraceId.set(trace.pcb_trace_id, obstacles)
        return obstacles
      },
    )
    const baseRectObstacles = this.terminalObstacles.map(
      (obstacle, obstacleIndex) =>
        convertRectObstacle(
          obstacle,
          obstacleIndex,
          params.srj.layerCount,
          params.connMap,
        ),
    )
    this.fixedObstacles = [...baseRectObstacles, ...preloadedTraceObstacles]
  }

  getPreloadedTraceIdForDrcTraceId(
    drcTraceId: string | undefined,
  ): string | undefined {
    if (!drcTraceId) return undefined
    for (const traceId of this.preloadedObstaclesByTraceId.keys()) {
      if (
        drcTraceId === traceId ||
        drcTraceId.endsWith(`_${traceId}`) ||
        drcTraceId.includes(`_${traceId}_`)
      ) {
        return traceId
      }
    }
    return undefined
  }

  countRouteOverlapsWithPreloadedTrace(
    route: HighDensityRoute,
    preloadedTraceId: string,
  ): number {
    const fixedObstacles =
      this.preloadedObstaclesByTraceId.get(preloadedTraceId) ?? []
    let overlapCount = 0

    for (const fixedObstacle of fixedObstacles) {
      for (
        let fixedIndex = 0;
        fixedIndex < fixedObstacle.route.length - 1;
        fixedIndex += 1
      ) {
        const fixedStart = fixedObstacle.route[fixedIndex]!
        const fixedEnd = fixedObstacle.route[fixedIndex + 1]!
        if (fixedStart.z !== fixedEnd.z) continue
        const requiredDistance =
          fixedObstacle.traceThickness / 2 + route.traceThickness / 2

        for (
          let candidateIndex = 0;
          candidateIndex < route.route.length - 1;
          candidateIndex += 1
        ) {
          const candidateStart = route.route[candidateIndex]!
          const candidateEnd = route.route[candidateIndex + 1]!
          if (
            candidateStart.z !== candidateEnd.z ||
            candidateStart.z !== fixedStart.z
          ) {
            continue
          }
          if (
            minimumDistanceBetweenSegments(
              candidateStart,
              candidateEnd,
              fixedStart,
              fixedEnd,
            ) <
            requiredDistance - SAME_POINT_EPSILON
          ) {
            overlapCount += 1
          }
        }
      }
    }

    overlapCount += this.getRouteViaCentersOverlappingPreloadedTrace(
      route,
      preloadedTraceId,
    ).length

    return overlapCount
  }

  getRouteViaCentersOverlappingPreloadedTrace(
    route: HighDensityRoute,
    preloadedTraceId: string,
  ): Array<{ x: number; y: number }> {
    const fixedObstacles =
      this.preloadedObstaclesByTraceId.get(preloadedTraceId) ?? []
    const candidateVias = getRouteVias(route.route)
    const overlappingVias: Array<{ x: number; y: number }> = []

    for (const candidateVia of candidateVias) {
      let overlaps = false
      for (const fixedObstacle of fixedObstacles) {
        const requiredDistance =
          fixedObstacle.traceThickness / 2 +
          route.viaDiameter / 2 +
          RELAXED_VIA_TRACE_CLEARANCE
        for (
          let fixedIndex = 0;
          fixedIndex < fixedObstacle.route.length - 1;
          fixedIndex += 1
        ) {
          const fixedStart = fixedObstacle.route[fixedIndex]!
          const fixedEnd = fixedObstacle.route[fixedIndex + 1]!
          if (fixedStart.z !== fixedEnd.z) continue
          if (
            pointToSegmentDistance(candidateVia, fixedStart, fixedEnd) <
            requiredDistance - SAME_POINT_EPSILON
          ) {
            overlaps = true
            break
          }
        }
        if (overlaps) break
      }
      if (overlaps) overlappingVias.push(candidateVia)
    }

    return overlappingVias
  }

  private getOwningTerminalObstacles(
    route: HighDensityRoute,
    point: HighDensityRoute["route"][number],
  ): Obstacle[] {
    const owningObstacles = this.terminalObstacles.filter(
      (obstacle) =>
        obstacleRepresentsPhysicalPad(obstacle) &&
        obstacleAppliesToLayer(obstacle, point.z, this.srj.layerCount) &&
        isObstacleConnectedToRoute(obstacle, route, this.connMap) &&
        pointIsInsideObstacle(point, obstacle),
    )

    if (!point.pcb_port_id) return owningObstacles
    const matchingPortObstacles = owningObstacles.filter((obstacle) =>
      obstacle.connectedTo.includes(point.pcb_port_id!),
    )
    return matchingPortObstacles.length > 0
      ? matchingPortObstacles
      : owningObstacles
  }

  private getTerminalAccessPoints(
    route: HighDensityRoute,
    point: HighDensityRoute["route"][number],
  ): Array<{ x: number; y: number }> {
    const owningObstacles = this.getOwningTerminalObstacles(route, point)
    if (owningObstacles.length === 0) return []

    const points: Array<{ x: number; y: number }> = []
    const seenPoints = new Set<string>()
    const addPoint = (candidate: { x: number; y: number }) => {
      if (
        !Number.isFinite(candidate.x) ||
        !Number.isFinite(candidate.y) ||
        !pointFitsInsideBounds(
          candidate,
          this.srj.bounds,
          route.viaDiameter / 2,
        ) ||
        !owningObstacles.some((obstacle) =>
          pointIsInsideObstacle(candidate, obstacle),
        )
      ) {
        return
      }
      const key = getPointKey(candidate)
      if (seenPoints.has(key)) return
      seenPoints.add(key)
      points.push(candidate)
    }

    // Keep the exact routed terminal as the first choice. Moving to one of the
    // pad access points below is only necessary when several branches share a
    // terminal pad and their terminal vias need to be separated.
    addPoint({ x: point.x, y: point.y })

    for (const obstacle of owningObstacles) {
      const longAxisIsX = obstacle.width >= obstacle.height
      const longAxisLength = longAxisIsX ? obstacle.width : obstacle.height
      const maximumOffset = Math.max(
        0,
        longAxisLength / 2 - route.viaDiameter / 2,
      )
      const rotationRadians =
        ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180

      for (const offset of [-maximumOffset, maximumOffset, 0]) {
        const localX = longAxisIsX ? offset : 0
        const localY = longAxisIsX ? 0 : offset
        addPoint({
          x: snapToB01Grid(
            obstacle.center.x +
              localX * Math.cos(rotationRadians) -
              localY * Math.sin(rotationRadians),
          ),
          y: snapToB01Grid(
            obstacle.center.y +
              localX * Math.sin(rotationRadians) +
              localY * Math.cos(rotationRadians),
          ),
        })
      }
    }

    return points
  }

  /**
   * Produces a small, deterministic set of full-route escapes. Every access
   * point remains in the physical pad that owns the corresponding terminal,
   * and every possible routing layer is considered without using net- or
   * board-specific coordinates.
   */
  getTerminalViaEscapeCandidates(
    routes: HighDensityRoute[],
    routeIndex: number,
  ): Pipeline9TerminalViaEscapeCandidate[] {
    const route = routes[routeIndex]
    const start = route?.route[0]
    const end = route?.route.at(-1)
    if (!route || !start || !end || route.route.length < 2) return []

    const startAccessPoints = this.getTerminalAccessPoints(route, start)
    const endAccessPoints = this.getTerminalAccessPoints(route, end)
    if (startAccessPoints.length === 0 || endAccessPoints.length === 0) {
      return []
    }

    const alternateZs = Array.from(
      { length: this.srj.layerCount },
      (_, alternateZ) => alternateZ,
    ).filter((alternateZ) => alternateZ !== start.z || alternateZ !== end.z)
    const candidates: Pipeline9TerminalViaEscapeCandidate[] = []
    const accessPointPairCount =
      startAccessPoints.length * endAccessPoints.length

    // Interleave layers before advancing to the next pair of pad access
    // points. The exact-repair caller intentionally tries only a small prefix,
    // so layer-major ordering would starve every later board layer.
    for (
      let accessPointPairIndex = 0;
      accessPointPairIndex < accessPointPairCount;
      accessPointPairIndex += 1
    ) {
      const startVia =
        startAccessPoints[
          Math.floor(accessPointPairIndex / endAccessPoints.length)
        ]!
      const endVia =
        endAccessPoints[accessPointPairIndex % endAccessPoints.length]!
      for (const alternateZ of alternateZs) {
        candidates.push({ alternateZ, startVia, endVia })
        if (candidates.length >= MAX_TERMINAL_VIA_ESCAPE_CANDIDATES) {
          return candidates
        }
      }
    }

    return candidates
  }

  private terminalViaEscapeCandidateIsValid(
    route: HighDensityRoute,
    candidate: Pipeline9TerminalViaEscapeCandidate,
  ): boolean {
    const start = route.route[0]
    const end = route.route.at(-1)
    if (
      !start ||
      !end ||
      !Number.isInteger(candidate.alternateZ) ||
      candidate.alternateZ < 0 ||
      candidate.alternateZ >= this.srj.layerCount ||
      (candidate.alternateZ === start.z && candidate.alternateZ === end.z)
    ) {
      return false
    }

    const startOwningObstacles = this.getOwningTerminalObstacles(route, start)
    const endOwningObstacles = this.getOwningTerminalObstacles(route, end)
    return (
      Number.isFinite(candidate.startVia.x) &&
      Number.isFinite(candidate.startVia.y) &&
      Number.isFinite(candidate.endVia.x) &&
      Number.isFinite(candidate.endVia.y) &&
      pointFitsInsideBounds(
        candidate.startVia,
        this.srj.bounds,
        candidate.alternateZ === start.z
          ? route.traceThickness / 2
          : route.viaDiameter / 2,
      ) &&
      pointFitsInsideBounds(
        candidate.endVia,
        this.srj.bounds,
        candidate.alternateZ === end.z
          ? route.traceThickness / 2
          : route.viaDiameter / 2,
      ) &&
      startOwningObstacles.some((obstacle) =>
        pointIsInsideObstacle(candidate.startVia, obstacle),
      ) &&
      endOwningObstacles.some((obstacle) =>
        pointIsInsideObstacle(candidate.endVia, obstacle),
      )
    )
  }

  tryRerouteWithTerminalViaEscape(
    routes: HighDensityRoute[],
    options: Pipeline9TerminalViaEscapeOptions,
  ): Pipeline9B01RerouteResult | undefined {
    const targetRoute = routes[options.routeIndex]
    const originalStart = targetRoute?.route[0]
    const originalEnd = targetRoute?.route.at(-1)
    if (
      !targetRoute ||
      !originalStart ||
      !originalEnd ||
      targetRoute.route.length < 2 ||
      !this.terminalViaEscapeCandidateIsValid(targetRoute, options.candidate)
    ) {
      return undefined
    }

    const { candidate } = options
    const routingRoutes = routes.map((route, routeIndex) =>
      routeIndex === options.routeIndex
        ? {
            ...route,
            route: [
              {
                x: candidate.startVia.x,
                y: candidate.startVia.y,
                z: candidate.alternateZ,
                traceThickness: route.traceThickness,
              },
              {
                x: candidate.endVia.x,
                y: candidate.endVia.y,
                z: candidate.alternateZ,
                traceThickness: route.traceThickness,
              },
            ],
          }
        : route,
    )
    const result = this.tryReroute(routingRoutes, {
      routeIndex: options.routeIndex,
      omitCandidateRouteIndexes: options.omitCandidateRouteIndexes,
      includeCandidateCopper: options.includeCandidateCopper,
      reverse: options.reverse,
      shortenPath: options.shortenPath,
      maxIterations: options.maxIterations,
    })
    if (!result?.route) return result

    const rebuiltPoints: HighDensityRoute["route"] = []
    const pushPoint = (point: HighDensityRoute["route"][number]) => {
      if (!pointsAreEqual(rebuiltPoints.at(-1), point)) {
        rebuiltPoints.push(point)
      }
    }
    const makeAccessPoint = (point: { x: number; y: number }, z: number) => ({
      x: point.x,
      y: point.y,
      z,
      traceThickness: targetRoute.traceThickness,
    })

    pushPoint(originalStart)
    pushPoint(makeAccessPoint(candidate.startVia, originalStart.z))
    pushPoint(makeAccessPoint(candidate.startVia, candidate.alternateZ))
    for (const routedPoint of result.route.route) {
      const { pcb_port_id: _pcbPortId, ...point } = routedPoint
      pushPoint(point)
    }
    pushPoint(makeAccessPoint(candidate.endVia, candidate.alternateZ))
    pushPoint(makeAccessPoint(candidate.endVia, originalEnd.z))
    pushPoint(originalEnd)

    if (!routeStaysInsideBounds(rebuiltPoints, targetRoute, this.srj.bounds)) {
      return { iterations: result.iterations }
    }

    return {
      route: {
        ...targetRoute,
        route: rebuiltPoints,
        vias: [],
      },
      iterations: result.iterations,
    }
  }

  private getCandidateObstacles(
    routes: HighDensityRoute[],
    targetRouteIndex: number,
    omitCandidateRouteIndexes?: ReadonlySet<number>,
  ): HighDensityRouteObstacle[] {
    const omittedRouteIndexes = [...(omitCandidateRouteIndexes ?? [])]
      .filter((routeIndex) => routeIndex !== targetRouteIndex)
      .sort((left, right) => left - right)
    const cacheKey = `${targetRouteIndex}:${omittedRouteIndexes.join(",")}`
    const cachedForRoutes = this.candidateObstacleCache.get(routes)
    const cachedObstacles = cachedForRoutes?.get(cacheKey)
    if (cachedObstacles) return cachedObstacles

    const omittedRouteIndexSet = new Set(omittedRouteIndexes)
    const candidateObstacles = routes.flatMap((route, routeIndex) => {
      if (
        routeIndex === targetRouteIndex ||
        omittedRouteIndexSet.has(routeIndex) ||
        route.route.length < 2
      ) {
        return []
      }
      return [convertCandidateRouteToObstacle(route, this.connMap)]
    })
    const obstaclesByTarget =
      cachedForRoutes ?? new Map<string, HighDensityRouteObstacle[]>()
    obstaclesByTarget.set(cacheKey, candidateObstacles)
    if (!cachedForRoutes) {
      this.candidateObstacleCache.set(routes, obstaclesByTarget)
    }

    return candidateObstacles
  }

  tryReroute(
    routes: HighDensityRoute[],
    options: Pipeline9B01RerouteOptions,
  ): Pipeline9B01RerouteResult | undefined {
    const targetRoute = routes[options.routeIndex]
    if (!targetRoute || targetRoute.route.length < 2) return undefined

    const startIndex = options.startIndex ?? 0
    const endIndex = options.endIndex ?? targetRoute.route.length - 1
    const startPoint = targetRoute.route[startIndex]
    const endPoint = targetRoute.route[endIndex]
    if (
      !startPoint ||
      !endPoint ||
      startIndex < 0 ||
      endIndex >= targetRoute.route.length ||
      startIndex >= endIndex
    ) {
      return undefined
    }

    const routingWindow = getB01RoutingWindow(
      startPoint,
      endPoint,
      this.srj.bounds,
    )
    if (!routingWindow) {
      return { iterations: 0 }
    }

    const rootConnectionName =
      this.connMap?.getNetConnectedToId(targetRoute.connectionName) ??
      targetRoute.rootConnectionName ??
      targetRoute.connectionName.replace(/_mst\d+$/, "")
    const start = {
      connectionName: targetRoute.connectionName,
      rootConnectionName,
      x: startPoint.x,
      y: startPoint.y,
      z: startPoint.z,
    }
    const end = {
      connectionName: targetRoute.connectionName,
      rootConnectionName,
      x: endPoint.x,
      y: endPoint.y,
      z: endPoint.z,
    }
    const portPoints = options.reverse ? [end, start] : [start, end]
    const nodeWithPortPoints: NodeWithPortPoints = {
      capacityMeshNodeId: `pipeline9_b01_${options.routeIndex}`,
      center: routingWindow.center,
      width: routingWindow.width,
      height: routingWindow.height,
      availableZ: Array.from({ length: this.srj.layerCount }, (_, z) => z),
      portPoints,
    }
    const candidateObstacles = options.includeCandidateCopper
      ? this.getCandidateObstacles(
          routes,
          options.routeIndex,
          options.omitCandidateRouteIndexes,
        )
      : []
    const solver = new HighDensitySolverB01({
      nodeWithPortPoints,
      obstacles: [...this.fixedObstacles, ...candidateObstacles],
      highResolutionCellSize: B01_GRID_STEP,
      highResolutionCellThickness: 8,
      lowResolutionCellSize: B01_LOW_RESOLUTION_CELL_SIZE,
      traceThickness: targetRoute.traceThickness,
      traceMargin: B01_TRACE_CLEARANCE,
      obstacleClearanceMargin: B01_TRACE_CLEARANCE,
      viaDiameter: targetRoute.viaDiameter,
      viaMinDistFromBorder: 0,
      maxCellCount: 500_000,
      hyperParameters: {
        shuffleSeed: options.reverse ? 1 : options.shortenPath ? 2 : 0,
        viaBaseCost: 4,
        sameRootObstacleCostMultiplier: 0.05,
      },
    })
    solver.MAX_ITERATIONS = Math.max(1, Math.floor(options.maxIterations))
    solver.solve()
    if (!solver.solved) {
      return { iterations: solver.iterations }
    }
    const [solvedRoute] = solver.getOutput()
    if (!solvedRoute) return { iterations: solver.iterations }

    let reroutedPoints: HighDensityRoute["route"] = solvedRoute.route.map(
      ({ x, y, z }) => ({
        x,
        y,
        z,
        traceThickness: targetRoute.traceThickness,
      }),
    )
    const firstPoint = reroutedPoints[0]
    const lastPoint = reroutedPoints.at(-1)
    if (
      firstPoint &&
      lastPoint &&
      Math.hypot(lastPoint.x - startPoint.x, lastPoint.y - startPoint.y) <
        Math.hypot(firstPoint.x - startPoint.x, firstPoint.y - startPoint.y)
    ) {
      reroutedPoints.reverse()
    }
    reroutedPoints = simplifyB01Route(reroutedPoints)
    if (reroutedPoints.length < 2) {
      return { iterations: solver.iterations }
    }
    reroutedPoints[0] = { ...startPoint }
    reroutedPoints[reroutedPoints.length - 1] = { ...endPoint }
    reroutedPoints = normalizeEndpointLayerTransitions(reroutedPoints)
    if (!routeStaysInsideBounds(reroutedPoints, targetRoute, this.srj.bounds)) {
      return { iterations: solver.iterations }
    }

    const route = [
      ...targetRoute.route.slice(0, startIndex),
      ...reroutedPoints,
      ...targetRoute.route.slice(endIndex + 1),
    ].filter(
      (point, pointIndex, allPoints) =>
        !pointsAreEqual(allPoints[pointIndex - 1], point),
    )

    return {
      route: {
        ...targetRoute,
        route,
        vias: getRouteVias(route),
      },
      iterations: solver.iterations,
    }
  }
}
