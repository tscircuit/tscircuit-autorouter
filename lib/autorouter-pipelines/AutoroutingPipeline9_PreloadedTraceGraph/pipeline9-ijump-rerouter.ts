import { MultilayerIjump } from "@tscircuit/infgrid-ijump-astar"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import type { Obstacle, SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { getObstaclesFromSrjTraces } from "lib/utils/convertSrjTracesToObstacles"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

type Pipeline9IjumpRerouterParams = {
  srj: SimpleRouteJson
  baseObstacles: Obstacle[]
  connMap?: ConnectivityMap
  viaHoleDiameter?: number
}

export type Pipeline9IjumpRerouteOptions = {
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

export type Pipeline9IjumpRerouteResult = {
  route?: HighDensityRoute
  iterations: number
}

export type Pipeline9TerminalViaEscapeCandidate = {
  alternateZ: number
  startVia: { x: number; y: number }
  endVia: { x: number; y: number }
}

export type Pipeline9TerminalViaEscapeOptions = Omit<
  Pipeline9IjumpRerouteOptions,
  "startIndex" | "endIndex"
> & {
  candidate: Pipeline9TerminalViaEscapeCandidate
}

const SAME_POINT_EPSILON = 1e-9
const RELAXED_TRACE_CLEARANCE = 0.1
const IJUMP_GRID_STEP = 0.05
const MAX_TERMINAL_VIA_ESCAPE_CANDIDATES = 64

const getFailedAttemptIterationCost = (
  solverIterations: number | undefined,
  maxIterations: number,
): number => {
  const boundedMaxIterations = Math.max(0, Math.floor(maxIterations))
  if (boundedMaxIterations === 0) return 0
  if (solverIterations === undefined || !Number.isFinite(solverIterations)) {
    return boundedMaxIterations
  }

  // MultilayerIjump starts at -1 and resets to zero only once a connection
  // search begins. An exception during its connection setup must still consume
  // budget, otherwise exact repair can retry a broken setup for free.
  return Math.min(
    boundedMaxIterations,
    Math.max(1, Math.floor(solverIterations)),
  )
}

const pointsAreEqual = (
  left: HighDensityRoute["route"][number] | undefined,
  right: HighDensityRoute["route"][number],
) =>
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

const reverseSimplifiedRoute = (
  route: SimplifiedPcbTrace["route"],
): SimplifiedPcbTrace["route"] =>
  route.toReversed().map((point) =>
    point.route_type === "via"
      ? {
          ...point,
          from_layer: point.to_layer,
          to_layer: point.from_layer,
        }
      : point,
  )

const convertSimplifiedRouteToHdPoints = (
  simplifiedRoute: SimplifiedPcbTrace["route"],
  layerCount: number,
  traceThickness: number,
): HighDensityRoute["route"] | undefined => {
  const points: HighDensityRoute["route"] = []
  const pushPoint = (point: HighDensityRoute["route"][number]) => {
    if (!pointsAreEqual(points.at(-1), point)) points.push(point)
  }

  for (const point of simplifiedRoute) {
    if (point.route_type === "wire") {
      const z = mapLayerNameToZ(point.layer, layerCount)
      if (
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        !Number.isInteger(z) ||
        z < 0 ||
        z >= layerCount
      ) {
        return undefined
      }
      pushPoint({
        x: point.x,
        y: point.y,
        z,
        traceThickness,
      })
      continue
    }

    if (point.route_type === "via") {
      const fromZ = mapLayerNameToZ(point.from_layer, layerCount)
      const toZ = mapLayerNameToZ(point.to_layer, layerCount)
      if (
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        !Number.isInteger(fromZ) ||
        !Number.isInteger(toZ) ||
        fromZ < 0 ||
        fromZ >= layerCount ||
        toZ < 0 ||
        toZ >= layerCount
      ) {
        return undefined
      }
      pushPoint({ x: point.x, y: point.y, z: fromZ, traceThickness })
      pushPoint({ x: point.x, y: point.y, z: toZ, traceThickness })
      continue
    }

    return undefined
  }

  if (points.length < 2) return undefined
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index]!
    const next = points[index + 1]!
    if (
      current.z !== next.z &&
      (Math.abs(current.x - next.x) > SAME_POINT_EPSILON ||
        Math.abs(current.y - next.y) > SAME_POINT_EPSILON)
    ) {
      return undefined
    }
  }
  return points
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

const snapToIjumpGrid = (value: number): number => {
  const snapped = Math.round(value / IJUMP_GRID_STEP) * IJUMP_GRID_STEP
  return Math.abs(snapped) <= SAME_POINT_EPSILON ? 0 : snapped
}

const getPointKey = (point: { x: number; y: number }): string =>
  `${point.x.toFixed(9)}:${point.y.toFixed(9)}`

export class Pipeline9IjumpRerouter {
  private readonly srj: SimpleRouteJson
  private readonly connMap?: ConnectivityMap
  private readonly viaHoleDiameter?: number
  private readonly terminalObstacles: Obstacle[]
  private readonly baseObstacles: Obstacle[]
  private readonly candidateObstacleCache = new WeakMap<
    HighDensityRoute[],
    Map<string, Obstacle[]>
  >()

  constructor(params: Pipeline9IjumpRerouterParams) {
    this.srj = params.srj
    this.connMap = params.connMap
    this.viaHoleDiameter = params.viaHoleDiameter
    this.terminalObstacles = params.baseObstacles.map((obstacle) =>
      addCanonicalConnectivity(obstacle, params.connMap),
    )
    this.baseObstacles = addApproximatingRectsToSrj({
      ...params.srj,
      obstacles: this.terminalObstacles,
      connections: [],
      traces: undefined,
    }).obstacles
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
          x: snapToIjumpGrid(
            obstacle.center.x +
              localX * Math.cos(rotationRadians) -
              localY * Math.sin(rotationRadians),
          ),
          y: snapToIjumpGrid(
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
  ): Pipeline9IjumpRerouteResult | undefined {
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
  ): Obstacle[] {
    const omittedRouteIndexes = [...(omitCandidateRouteIndexes ?? [])]
      .filter((routeIndex) => routeIndex !== targetRouteIndex)
      .sort((left, right) => left - right)
    const cacheKey = `${targetRouteIndex}:${omittedRouteIndexes.join(",")}`
    const cachedForRoutes = this.candidateObstacleCache.get(routes)
    const cachedObstacles = cachedForRoutes?.get(cacheKey)
    if (cachedObstacles) return cachedObstacles

    const omittedRouteIndexSet = new Set(omittedRouteIndexes)
    const traces = routes.flatMap((route, routeIndex) => {
      if (
        routeIndex === targetRouteIndex ||
        omittedRouteIndexSet.has(routeIndex) ||
        route.route.length < 2
      ) {
        return []
      }
      return [
        {
          type: "pcb_trace" as const,
          pcb_trace_id: `pipeline9_candidate_${routeIndex}`,
          connection_name: route.connectionName,
          route: convertHdRouteToSimplifiedRoute(route, this.srj.layerCount, {
            defaultViaHoleDiameter: this.viaHoleDiameter,
            obstacles: this.baseObstacles,
            connMap: this.connMap,
          }),
        },
      ]
    })
    const traceObstacles = getObstaclesFromSrjTraces(
      {
        ...this.srj,
        obstacles: [],
        connections: [],
        traces,
      },
      {
        includeConnectionNameInConnectedTo: true,
        includeSquareCaps: true,
        modelJumperPads: true,
      },
    ).map((obstacle) => addCanonicalConnectivity(obstacle, this.connMap))

    const candidateObstacles = addApproximatingRectsToSrj({
      ...this.srj,
      obstacles: traceObstacles,
      connections: [],
      traces: undefined,
    }).obstacles
    const obstaclesByTarget = cachedForRoutes ?? new Map<string, Obstacle[]>()
    obstaclesByTarget.set(cacheKey, candidateObstacles)
    if (!cachedForRoutes) {
      this.candidateObstacleCache.set(routes, obstaclesByTarget)
    }

    return candidateObstacles
  }

  tryReroute(
    routes: HighDensityRoute[],
    options: Pipeline9IjumpRerouteOptions,
  ): Pipeline9IjumpRerouteResult | undefined {
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

    const start = {
      x: startPoint.x,
      y: startPoint.y,
      layer: mapZToLayerName(startPoint.z, this.srj.layerCount),
    }
    const end = {
      x: endPoint.x,
      y: endPoint.y,
      layer: mapZToLayerName(endPoint.z, this.srj.layerCount),
    }
    const pointsToConnect = options.reverse ? [end, start] : [start, end]
    const candidateObstacles = options.includeCandidateCopper
      ? this.getCandidateObstacles(
          routes,
          options.routeIndex,
          options.omitCandidateRouteIndexes,
        )
      : []
    const input = {
      ...this.srj,
      obstacles: [...this.baseObstacles, ...candidateObstacles],
      connections: [
        {
          name: targetRoute.connectionName,
          pointsToConnect,
        },
      ],
      traces: undefined,
    }

    let solver: MultilayerIjump | undefined
    try {
      solver = new MultilayerIjump({
        input: input as never,
        connMap: this.connMap,
        GRID_STEP: IJUMP_GRID_STEP,
        OBSTACLE_MARGIN:
          RELAXED_TRACE_CLEARANCE + targetRoute.traceThickness / 2,
        MAX_ITERATIONS: options.maxIterations,
        VIA_COST: 4,
        isRemovePathLoopsEnabled: true,
        isShortenPathWithShortcutsEnabled: options.shortenPath,
        optimizeWithGoalBoxes: false,
      })
      solver.VIA_DIAMETER = targetRoute.viaDiameter
      solver.GOAL_RUSH_FACTOR = 1.1

      const [rawTrace] = solver.solveAndMapToTraces()
      if (!rawTrace) return { iterations: solver.iterations }
      const simplifiedRoute = options.reverse
        ? reverseSimplifiedRoute(
            (rawTrace as unknown as SimplifiedPcbTrace).route,
          )
        : (rawTrace as unknown as SimplifiedPcbTrace).route
      const reroutedPoints = convertSimplifiedRouteToHdPoints(
        simplifiedRoute,
        this.srj.layerCount,
        targetRoute.traceThickness,
      )
      if (!reroutedPoints) return { iterations: solver.iterations }

      reroutedPoints[0] = { ...reroutedPoints[0]!, ...startPoint }
      reroutedPoints[reroutedPoints.length - 1] = {
        ...reroutedPoints.at(-1)!,
        ...endPoint,
      }
      if (
        !routeStaysInsideBounds(reroutedPoints, targetRoute, this.srj.bounds)
      ) {
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
          vias: [],
        },
        iterations: solver.iterations,
      }
    } catch {
      return {
        iterations: getFailedAttemptIterationCost(
          solver?.iterations,
          options.maxIterations,
        ),
      }
    }
  }
}
