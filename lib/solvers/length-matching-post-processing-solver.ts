import {
  LengthMatchingSolver,
  PostProcessingSolver,
  TraceRoutingSolver,
  type PostProcessingSolverParams,
  type TraceRoutingConnection,
} from "@tscircuit/length-matching-solver"
import type { GraphicsObject } from "graphics-debug"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type {
  DifferentialPair,
  Obstacle,
  SimplifiedPcbTraces,
  SimpleRouteBus,
  SimpleRouteConnection,
} from "lib/types/srj-types"
import { BaseSolver } from "./BaseSolver"

type LengthMatchingPostProcessingSolverParams = {
  /** Constrained point pairs, routed before pair and bus matching. */
  routingConnections: TraceRoutingConnection[]
  /** Point-pair declarations behind `routingConnections`, with alias metadata. */
  pointPairConnections: SimpleRouteConnection[]
  differentialPairs: DifferentialPair[]
  buses: SimpleRouteBus[]
  connections: SimpleRouteConnection[]
  traces?: SimplifiedPcbTraces
  obstacles: Obstacle[]
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  layerCount: number
  obstacleMargin: number
}

const getLogicalConnectionLength = (
  routes: HighDensityRoute[],
  connectionName: string,
): number | undefined => {
  const matchingRoutes = routes.filter(
    (route) =>
      (route.rootConnectionName ?? route.connectionName) === connectionName,
  )
  if (matchingRoutes.length === 0) return undefined
  return matchingRoutes.reduce(
    (connectionLength, route) =>
      connectionLength +
      route.route.slice(1).reduce((routeLength, point, pointIndex) => {
        const previousPoint = route.route[pointIndex]!
        return (
          routeLength +
          Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y)
        )
      }, 0),
    0,
  )
}

const getBusLengthMatchingPairs = (
  buses: SimpleRouteBus[],
  routes: HighDensityRoute[],
): DifferentialPair[] =>
  buses.flatMap((bus) => {
    const maxLengthSkew = bus.maxLengthSkew
    if (maxLengthSkew === undefined || bus.connectionNames.length < 2) return []
    const memberLengths = bus.connectionNames.map((connectionName) => {
      const length = getLogicalConnectionLength(routes, connectionName)
      if (length === undefined)
        throw new Error(
          `Length matching: bus "${bus.busId}" has no routed geometry for connection "${connectionName}"`,
        )
      return { connectionName, length }
    })
    const longestMember = memberLengths.reduce((longest, member) =>
      member.length > longest.length ? member : longest,
    )
    return memberLengths.flatMap((member): DifferentialPair[] =>
      member.connectionName === longestMember.connectionName
        ? []
        : [
            {
              connectionNames: [
                member.connectionName,
                longestMember.connectionName,
              ],
              lengthTolerance: maxLengthSkew,
            },
          ],
    )
  })

const getLogicalLengthMatchingConnections = (
  buses: SimpleRouteBus[],
  connections: SimpleRouteConnection[],
): SimpleRouteConnection[] => {
  const constrainedConnectionNames = new Set(
    buses.flatMap((bus) =>
      bus.maxLengthSkew === undefined ? [] : bus.connectionNames,
    ),
  )
  return connections.flatMap((connection) => {
    if (!constrainedConnectionNames.has(connection.name)) return []
    const firstPoint = connection.pointsToConnect[0]
    const lastPoint = connection.pointsToConnect.at(-1)
    if (!firstPoint || !lastPoint || firstPoint === lastPoint)
      throw new Error(
        `Length matching: bus connection "${connection.name}" needs at least two points`,
      )
    return [
      {
        ...connection,
        // The matcher tunes the sum of HD routes sharing this logical root.
        // Its connection declarations only identify the root and its terminals.
        pointsToConnect: [firstPoint, lastPoint],
      },
    ]
  })
}

const assertBusLengthSkew = (
  buses: SimpleRouteBus[],
  routes: HighDensityRoute[],
): void => {
  for (const bus of buses) {
    if (bus.maxLengthSkew === undefined || bus.connectionNames.length < 2)
      continue
    const lengths = bus.connectionNames.map((connectionName) => {
      const length = getLogicalConnectionLength(routes, connectionName)
      if (length === undefined)
        throw new Error(
          `Length matching: bus "${bus.busId}" lost routed geometry for connection "${connectionName}"`,
        )
      return length
    })
    const routedSkew = Math.max(...lengths) - Math.min(...lengths)
    if (routedSkew > bus.maxLengthSkew + 1e-6)
      throw new Error(
        `Length matching: bus "${bus.busId}" routed length skew ${routedSkew.toFixed(4)}mm exceeds ${bus.maxLengthSkew.toFixed(4)}mm`,
      )
  }
}

/** Routes constrained connections, then couples pairs and tunes bus roots. */
export class LengthMatchingPostProcessingSolver extends BaseSolver {
  private readonly traceRoutingSolver: TraceRoutingSolver
  private differentialPairSolver?: PostProcessingSolver
  private busLengthMatchingSolver?: LengthMatchingSolver
  private outputHdRoutes?: HighDensityRoute[]

  constructor(
    private readonly params: LengthMatchingPostProcessingSolverParams,
  ) {
    super()
    this.traceRoutingSolver = new TraceRoutingSolver({
      connections: params.routingConnections,
      traces: params.traces,
      obstacles: params.obstacles,
      bounds: params.bounds,
      layerCount: params.layerCount,
      minTraceToPadEdgeClearance: params.obstacleMargin,
    })
    this.MAX_ITERATIONS = this.traceRoutingSolver.MAX_ITERATIONS + 1
  }

  override getSolverName(): string {
    return "LengthMatchingPostProcessingSolver"
  }

  private getDifferentialPairs(): PostProcessingSolverParams["differentialPairs"] {
    return this.params.differentialPairs.map(({ traceGap, ...pair }) => {
      const connections = pair.connectionNames.map((connectionName) => {
        const matches = this.params.pointPairConnections.filter(
          (connection) =>
            connection.name === connectionName ||
            connection.__rootConnectionNames?.includes(connectionName) ||
            connection.__netConnectionName === connectionName,
        )
        const connection = this.params.routingConnections.find(
          (candidate) => candidate.connectionName === matches[0]?.name,
        )
        if (matches.length !== 1 || !connection)
          throw new Error(
            `Length matching: differential pair connection "${connectionName}" must resolve to exactly one point-pair connection, got ${matches.length}`,
          )
        return connection
      })
      const connectionNames = connections.map(
        (connection) => connection.connectionName,
      ) as [string, string]
      if (traceGap === undefined) return { ...pair, connectionNames }
      const centerlineDistance =
        traceGap +
        connections[0]!.traceThickness / 2 +
        connections[1]!.traceThickness / 2
      return {
        ...pair,
        connectionNames,
        minimumCenterlineDistance: centerlineDistance,
        maximumCenterlineDistance: centerlineDistance,
      }
    })
  }

  override _step(): void {
    if (!this.traceRoutingSolver.solved) {
      this.traceRoutingSolver.step()
      // Routing grows its bound as each connection's search grid is built.
      this.MAX_ITERATIONS = this.traceRoutingSolver.MAX_ITERATIONS + 1
      if (this.traceRoutingSolver.failed) {
        this.failed = true
        this.error = this.traceRoutingSolver.error
      }
      return
    }
    if (!this.differentialPairSolver) {
      this.differentialPairSolver = new PostProcessingSolver({
        hdRoutes: this.traceRoutingSolver.getOutput().hdRoutes,
        differentialPairs: this.getDifferentialPairs(),
        traces: this.params.traces,
        obstacles: this.params.obstacles,
        bounds: this.params.bounds,
        layerCount: this.params.layerCount,
        minTraceToPadEdgeClearance: this.params.obstacleMargin,
      })
      this.MAX_ITERATIONS =
        this.iterations +
        this.differentialPairSolver.MAX_ITERATIONS +
        100_000 +
        10
      return
    }
    if (!this.differentialPairSolver.solved) {
      this.differentialPairSolver.step()
      if (this.differentialPairSolver.failed) {
        this.failed = true
        this.error = this.differentialPairSolver.error
      }
      return
    }

    if (!this.busLengthMatchingSolver) {
      const hdRoutes = this.differentialPairSolver.getOutput().hdRoutes
      const differentialPairs = getBusLengthMatchingPairs(
        this.params.buses,
        hdRoutes,
      )
      if (differentialPairs.length === 0) {
        this.outputHdRoutes = hdRoutes
        this.solved = true
        return
      }
      this.busLengthMatchingSolver = new LengthMatchingSolver({
        hdRoutes,
        originalConnections: getLogicalLengthMatchingConnections(
          this.params.buses,
          this.params.connections,
        ),
        differentialPairs,
        traces: this.params.traces,
        obstacles: this.params.obstacles,
        bounds: this.params.bounds,
        layerCount: this.params.layerCount,
        obstacleMargin: this.params.obstacleMargin,
      })
      return
    }

    this.busLengthMatchingSolver.step()
    if (this.busLengthMatchingSolver.failed) {
      this.failed = true
      this.error = this.busLengthMatchingSolver.error
      return
    }
    if (!this.busLengthMatchingSolver.solved) return
    this.outputHdRoutes =
      this.busLengthMatchingSolver.getOutput().matchedHdRoutes
    assertBusLengthSkew(this.params.buses, this.outputHdRoutes)
    this.solved = true
  }

  getOutput(): { hdRoutes: HighDensityRoute[] } {
    if (!this.solved || !this.outputHdRoutes)
      throw new Error(
        "LengthMatchingPostProcessingSolver output requested before completion",
      )
    return { hdRoutes: this.outputHdRoutes }
  }

  override visualize(): GraphicsObject {
    return (
      this.busLengthMatchingSolver?.visualize() ??
      this.differentialPairSolver?.visualize() ??
      this.traceRoutingSolver.visualize()
    )
  }
}
