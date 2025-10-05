import type { GraphicsObject } from "graphics-debug"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "../../types/high-density-types"
import { BaseSolver } from "../BaseSolver"
import { SingleHighDensityRouteSolver } from "./SingleHighDensityRouteSolver"
import { safeTransparentize } from "../colors"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "./SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { HighDensityHyperParameters } from "./HighDensityHyperParameters"
import { cloneAndShuffleArray } from "lib/utils/cloneAndShuffleArray"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"
import { getMinDistBetweenEnteringPoints } from "lib/utils/getMinDistBetweenEnteringPoints"

export class IntraNodeRouteSolver extends BaseSolver {
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
  }) {
    const { nodeWithPortPoints, colorMap } = params
    super()
    this.nodeWithPortPoints = nodeWithPortPoints
    this.colorMap = colorMap ?? {}
    this.solvedRoutes = []
    this.hyperParameters = params.hyperParameters ?? {}
    this.failedSubSolvers = []
    this.connMap = params.connMap
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
  //       viaDiameter: 0.6,
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
      if (A.x === B.x && A.y === B.y && A.z === B.z) {
        return
      }
    }
    const { connectionName, points } = unsolvedConnection
    this.activeSubSolver =
      new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
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
                !this.connMap!.areIdsConnected(
                  sr.connectionName,
                  connectionName,
                ),
            )
          : this.solvedRoutes,
        futureConnections: this.unsolvedConnections,
        layerCount: 2,
        hyperParameters: this.hyperParameters,
        connMap: this.connMap,
      })
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
