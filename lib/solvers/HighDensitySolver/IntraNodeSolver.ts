import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import { cloneAndShuffleArray } from "lib/utils/cloneAndShuffleArray"
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"
import { getMinDistBetweenEnteringPoints } from "lib/utils/getMinDistBetweenEnteringPoints"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "../../types/high-density-types"
import { BaseSolver } from "../BaseSolver"
import { safeTransparentize } from "../colors"
import { HighDensityHyperParameters } from "./HighDensityHyperParameters"
import { SingleHighDensityRouteSolver } from "./SingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "./SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

export class IntraNodeRouteSolver extends BaseSolver {
  override getSolverName(): string {
    return "IntraNodeRouteSolver"
  }

  nodeWithPortPoints: NodeWithPortPoints
  colorMap: Record<string, string>
  unsolvedConnections: {
    connectionName: string
    points: { x: number; y: number; z: number }[]
  }[]

  totalConnections: number
  solvedRoutes: HighDensityIntraNodeRoute[]
  failedSubSolvers: SingleHighDensityRouteSolver[]
  hyperParameters: Partial<HighDensityHyperParameters>
  minDistBetweenEnteringPoints: number
  viaDiameter: number
  traceWidth: number

  activeSubSolver: SingleHighDensityRouteSolver | null = null
  connMap?: ConnectivityMap

  // Legacy compat
  get failedSolvers() {
    return this.failedSubSolvers
  }

  // Legacy compat
  get activeSolver() {
    return this.activeSubSolver
  }

  constructor(params: {
    nodeWithPortPoints: NodeWithPortPoints
    colorMap?: Record<string, string>
    hyperParameters?: Partial<HighDensityHyperParameters>
    connMap?: ConnectivityMap
    viaDiameter?: number
    traceWidth?: number
  }) {
    const { nodeWithPortPoints, colorMap } = params
    super()
    this.nodeWithPortPoints = nodeWithPortPoints
    this.colorMap = colorMap ?? {}
    this.solvedRoutes = []
    this.hyperParameters = params.hyperParameters ?? {}
    this.failedSubSolvers = []
    this.connMap = params.connMap
    this.viaDiameter = params.viaDiameter ?? 0.3
    this.traceWidth = params.traceWidth ?? 0.15
    const unsolvedConnectionsMap: Map<
      string,
      { x: number; y: number; z: number }[]
    > = new Map()
    for (const { connectionName, x, y, z } of nodeWithPortPoints.portPoints) {
      unsolvedConnectionsMap.set(connectionName, [
        ...(unsolvedConnectionsMap.get(connectionName) ?? []),
        { x, y, z: z ?? 0 },
      ])
    }
    this.unsolvedConnections = Array.from(
      unsolvedConnectionsMap.entries().map(([connectionName, points]) => ({
        connectionName,
        points,
      })),
    )

    if (this.hyperParameters.SHUFFLE_SEED) {
      this.unsolvedConnections = cloneAndShuffleArray(
        this.unsolvedConnections,
        this.hyperParameters.SHUFFLE_SEED ?? 0,
      )

      // Shuffle the starting and ending points of each connection (some
      // algorithms are biased towards the start or end of a trace)
      this.unsolvedConnections = this.unsolvedConnections.map(
        ({ points, ...rest }, i) => ({
          ...rest,
          points: cloneAndShuffleArray(
            points,
            i * 7117 + (this.hyperParameters.SHUFFLE_SEED ?? 0),
          ),
        }),
      )
    }

    this.totalConnections = this.unsolvedConnections.length
    this.MAX_ITERATIONS = 1_000 * this.totalConnections ** 1.5

    this.minDistBetweenEnteringPoints = getMinDistBetweenEnteringPoints(
      this.nodeWithPortPoints,
    )

    // const {
    //   numEntryExitLayerChanges,
    //   numSameLayerCrossings,
    //   numTransitionPairCrossings,
    //   numTransitions,
    // } = getIntraNodeCrossings(this.nodeWithPortPoints)

    // if (this.nodeWithPortPoints.portPoints.length === 4) {

    // }

    // if (
    //   numSameLayerCrossings === 0 &&
    //   numTransitions === 0 &&
    //   numEntryExitLayerChanges === 0
    // ) {
    //   this.handleSimpleNoCrossingsCase()
    // }
  }

  // handleSimpleNoCrossingsCase() {
  //   // TODO check to make sure there are no crossings due to trace width
  //   this.solved = true
  //   this.solvedRoutes = this.unsolvedConnections.map(
  //     ({ connectionName, points }) => ({
  //       connectionName,
  //       route: points,
  //       traceThickness: 0.1, // TODO load from hyperParameters
  //       viaDiameter: 0.3,
  //       vias: [],
  //     }),
  //   )
  //   this.unsolvedConnections = []
  // }

  computeProgress() {
    return (
      (this.solvedRoutes.length + (this.activeSubSolver?.progress || 0)) /
      this.totalConnections
    )
  }

  private getSingleRouteSolverOpts(unsolvedConnection: {
    connectionName: string
    points: { x: number; y: number; z: number }[]
  }) {
    const { connectionName, points } = unsolvedConnection
    return {
      connectionName,
      minDistBetweenEnteringPoints: this.minDistBetweenEnteringPoints,
      bounds: getBoundsFromNodeWithPortPoints(this.nodeWithPortPoints),
      A: { x: points[0].x, y: points[0].y, z: points[0].z },
      B: {
        x: points[points.length - 1].x,
        y: points[points.length - 1].y,
        z: points[points.length - 1].z,
      },
      obstacleRoutes: this.connMap
        ? this.solvedRoutes.filter(
            (sr) =>
              !this.connMap!.areIdsConnected(sr.connectionName, connectionName),
          )
        : this.solvedRoutes,
      futureConnections: this.unsolvedConnections,
      layerCount: this.nodeWithPortPoints.portPoints.reduce(
        (max, p) => Math.max(max, (p.z ?? 0) + 1),
        2,
      ),
      hyperParameters: this.hyperParameters,
      connMap: this.connMap,
      viaDiameter: this.viaDiameter,
      traceThickness: this.traceWidth,
    }
  }

  private trySolveSamePointLayerChange(unsolvedConnection: {
    connectionName: string
    points: { x: number; y: number; z: number }[]
  }) {
    const opts = this.getSingleRouteSolverOpts(unsolvedConnection)
    const obstacleChecker =
      new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost(opts)
    const { A, B } = opts
    const viaClearance =
      obstacleChecker.viaDiameter / 2 + obstacleChecker.obstacleMargin / 2
    const baseOffset = Math.max(
      obstacleChecker.cellStep * 2,
      obstacleChecker.viaDiameter,
      obstacleChecker.traceThickness * 2,
    )

    const candidateViaPoints = dedupeCandidateViaPoints([
      { x: A.x, y: A.y },
      {
        x: this.nodeWithPortPoints.center.x,
        y: this.nodeWithPortPoints.center.y,
      },
      { x: A.x + baseOffset, y: A.y },
      { x: A.x - baseOffset, y: A.y },
      { x: A.x, y: A.y + baseOffset },
      { x: A.x, y: A.y - baseOffset },
      { x: A.x + baseOffset, y: A.y + baseOffset },
      { x: A.x + baseOffset, y: A.y - baseOffset },
      { x: A.x - baseOffset, y: A.y + baseOffset },
      { x: A.x - baseOffset, y: A.y - baseOffset },
    ]).filter((viaPoint) =>
      isCandidateInsideBounds(viaPoint, opts.bounds, viaClearance),
    )

    for (const viaPoint of candidateViaPoints) {
      if (
        !isViaPointSafe(
          obstacleChecker,
          viaPoint,
          A,
          B,
          this.nodeWithPortPoints.center,
        )
      ) {
        continue
      }

      const route = [
        { x: A.x, y: A.y, z: A.z },
        { ...viaPoint, z: A.z },
        { ...viaPoint, z: B.z },
        { x: B.x, y: B.y, z: B.z },
      ].filter(
        (pt, idx, arr) =>
          idx === 0 ||
          Math.abs(pt.x - arr[idx - 1].x) > 1e-6 ||
          Math.abs(pt.y - arr[idx - 1].y) > 1e-6 ||
          pt.z !== arr[idx - 1].z,
      )

      this.solvedRoutes.push({
        connectionName: unsolvedConnection.connectionName,
        traceThickness: this.traceWidth,
        viaDiameter: this.viaDiameter,
        route,
        vias: [{ x: viaPoint.x, y: viaPoint.y }],
      })
      return true
    }

    return false
  }

  _step() {
    if (this.activeSubSolver) {
      this.activeSubSolver.step()
      this.progress = this.computeProgress()
      if (this.activeSubSolver.solved) {
        this.solvedRoutes.push(this.activeSubSolver.solvedPath!)
        this.activeSubSolver = null
      } else if (this.activeSubSolver.failed) {
        this.failedSubSolvers.push(this.activeSubSolver)
        this.activeSubSolver = null
        this.error = this.failedSubSolvers.map((s) => s.error).join("\n")
        this.failed = true
      }
      return
    }

    const unsolvedConnection = this.unsolvedConnections.pop()
    this.progress = this.computeProgress()
    if (!unsolvedConnection) {
      this.solved = this.failedSubSolvers.length === 0
      return
    }
    if (unsolvedConnection.points.length === 1) {
      return
    }
    if (unsolvedConnection.points.length === 2) {
      const [A, B] = unsolvedConnection.points
      const sameX = Math.abs(A.x - B.x) < 1e-6
      const sameY = Math.abs(A.y - B.y) < 1e-6

      if (sameX && sameY && A.z === B.z) {
        return
      }

      // Fast-path: if the points share the same x/y but differ in layer,
      // prefer a pure via or a nearby obstacle-free via before invoking
      // the heavier search-based solvers. This keeps the degenerate case
      // fast, but avoids blindly routing through the node center.
      if (sameX && sameY && A.z !== B.z) {
        if (this.trySolveSamePointLayerChange(unsolvedConnection)) return
      }
    }
    this.activeSubSolver =
      new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost(
        this.getSingleRouteSolverOpts(unsolvedConnection),
      )
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }

    // Draw node bounds
    // graphics.rects!.push({
    //   center: {
    //     x: this.nodeWithPortPoints.center.x,
    //     y: this.nodeWithPortPoints.center.y,
    //   },
    //   width: this.nodeWithPortPoints.width,
    //   height: this.nodeWithPortPoints.height,
    //   stroke: "gray",
    //   fill: "transparent",
    // })

    // Visualize input nodeWithPortPoints
    for (const pt of this.nodeWithPortPoints.portPoints) {
      graphics.points!.push({
        x: pt.x,
        y: pt.y,
        label: [pt.connectionName, `layer: ${pt.z}`].join("\n"),
        color: this.colorMap[pt.connectionName] ?? "blue",
      })
    }

    // Visualize solvedRoutes
    for (
      let routeIndex = 0;
      routeIndex < this.solvedRoutes.length;
      routeIndex++
    ) {
      const route = this.solvedRoutes[routeIndex]
      if (route.route.length > 0) {
        const routeColor = this.colorMap[route.connectionName] ?? "blue"

        // Draw route segments between points
        for (let i = 0; i < route.route.length - 1; i++) {
          const p1 = route.route[i]
          const p2 = route.route[i + 1]

          graphics.lines!.push({
            points: [p1, p2],
            strokeColor:
              p1.z === 0
                ? safeTransparentize(routeColor, 0.2)
                : safeTransparentize(routeColor, 0.8),
            layer: `route-layer-${p1.z}`,
            step: routeIndex,
            strokeWidth: route.traceThickness,
          })
        }

        // Draw vias
        for (const via of route.vias) {
          graphics.circles!.push({
            center: { x: via.x, y: via.y },
            radius: route.viaDiameter / 2,
            fill: safeTransparentize(routeColor, 0.5),
            layer: "via",
            step: routeIndex,
          })
        }
      }
    }

    // Draw border around the node
    const bounds = getBoundsFromNodeWithPortPoints(this.nodeWithPortPoints)
    const { minX, minY, maxX, maxY } = bounds

    // Draw the four sides of the border with thin red lines
    graphics.lines!.push({
      points: [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
        { x: minX, y: minY },
      ],
      strokeColor: "rgba(255, 0, 0, 0.25)",
      strokeDash: "4 4",
      layer: "border",
    })

    return graphics
  }
}

const EPSILON = 1e-6

const dedupeCandidateViaPoints = (points: { x: number; y: number }[]) => {
  const deduped: { x: number; y: number }[] = []
  for (const point of points) {
    if (
      deduped.some(
        (existing) =>
          Math.abs(existing.x - point.x) < EPSILON &&
          Math.abs(existing.y - point.y) < EPSILON,
      )
    ) {
      continue
    }
    deduped.push(point)
  }
  return deduped
}

const isCandidateInsideBounds = (
  point: { x: number; y: number },
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  clearance: number,
) =>
  point.x >= bounds.minX + clearance &&
  point.x <= bounds.maxX - clearance &&
  point.y >= bounds.minY + clearance &&
  point.y <= bounds.maxY - clearance

const isTraceSegmentSafe = (
  obstacleChecker: SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost,
  start: { x: number; y: number; z: number },
  end: { x: number; y: number; z: number },
) => {
  if (
    Math.abs(start.x - end.x) < EPSILON &&
    Math.abs(start.y - end.y) < EPSILON
  ) {
    return true
  }

  const candidateEnd = {
    ...end,
    parent: {
      ...start,
      g: 0,
      h: 0,
      f: 0,
      parent: null,
    },
    g: 0,
    h: 0,
    f: 0,
  }

  if (obstacleChecker.isNodeTooCloseToObstacle(candidateEnd)) return false
  if (obstacleChecker.doesPathToParentIntersectObstacle(candidateEnd)) {
    return false
  }

  const segmentLength = Math.hypot(end.x - start.x, end.y - start.y)
  const sampleStep = Math.max(
    obstacleChecker.traceThickness / 2,
    obstacleChecker.cellStep / 2,
    0.05,
  )
  const sampleCount = Math.max(1, Math.ceil(segmentLength / sampleStep))

  for (let i = 1; i < sampleCount; i++) {
    const t = i / sampleCount
    const sample = {
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
      z: start.z,
      parent: {
        ...start,
        g: 0,
        h: 0,
        f: 0,
        parent: null,
      },
      g: 0,
      h: 0,
      f: 0,
    }
    if (obstacleChecker.isNodeTooCloseToObstacle(sample, 0)) return false
  }

  return true
}

const isViaPointSafe = (
  obstacleChecker: SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost,
  viaPoint: { x: number; y: number },
  A: { x: number; y: number; z: number },
  B: { x: number; y: number; z: number },
  center: { x: number; y: number },
) => {
  const isAtEndpoint =
    Math.abs(viaPoint.x - A.x) < EPSILON && Math.abs(viaPoint.y - A.y) < EPSILON

  const viaNode = {
    x: viaPoint.x,
    y: viaPoint.y,
    z: A.z,
    parent: {
      x: A.x,
      y: A.y,
      z: A.z,
      g: 0,
      h: 0,
      f: 0,
      parent: null,
    },
    g: 0,
    h: 0,
    f: 0,
  }

  if (
    obstacleChecker.isNodeTooCloseToObstacle(
      viaNode,
      obstacleChecker.viaDiameter / 2 + obstacleChecker.obstacleMargin / 2,
      true,
    )
  ) {
    return false
  }

  if (
    !isAtEndpoint &&
    isCandidateInsideBounds(
      viaPoint,
      obstacleChecker.bounds,
      obstacleChecker.viaDiameter / 2 + obstacleChecker.obstacleMargin / 2,
    ) === false
  ) {
    return false
  }

  if (
    !isTraceSegmentSafe(obstacleChecker, A, { ...viaPoint, z: A.z }) ||
    !isTraceSegmentSafe(obstacleChecker, { ...viaPoint, z: B.z }, B)
  ) {
    return false
  }

  // Prefer solutions that don't drift through the center when the endpoint
  // itself works, but still allow the center if it is the only safe option.
  if (
    !isAtEndpoint &&
    Math.abs(viaPoint.x - center.x) < EPSILON &&
    Math.abs(viaPoint.y - center.y) < EPSILON
  ) {
    return true
  }

  return true
}
