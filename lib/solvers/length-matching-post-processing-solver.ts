import {
  LengthMatchingSolver,
  type LengthMatchingPair,
  PostProcessingSolver,
} from "@tscircuit/length-matching-solver"
import type { GraphicsObject } from "graphics-debug"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type {
  DifferentialPair,
  Obstacle,
  SimplifiedPcbTraces,
  SimpleRouteBus,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types/srj-types"
import { BaseSolver } from "./BaseSolver"
import { createRoutedBusLengthSolver } from "./createRoutedBusLengthSolver"

type LengthMatchingPostProcessingSolverParams = {
  hdRoutes: HighDensityRoute[]
  originalSrj?: SimpleRouteJson
  differentialPairs: DifferentialPair[]
  differentialPairLanes?: LengthMatchingPair[]
  buses?: SimpleRouteBus[]
  connections?: SimpleRouteConnection[]
  traces?: SimplifiedPcbTraces
  obstacles: Obstacle[]
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  layerCount: number
  obstacleMargin?: number
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

function needsRoutedBusLengthSolver(srj: SimpleRouteJson): boolean {
  const branchedConnections = new Set(
    srj.connections
      .filter((connection) => connection.pointsToConnect.length > 2)
      .map((connection) => connection.name),
  )
  return (srj.buses ?? []).some((bus) => {
    if (bus.minLength !== undefined || bus.maxLength !== undefined) return true
    if (bus.maxLengthSkew === undefined) return false
    return (
      Boolean(bus.lengthMatchToConnectionNames?.length) ||
      Boolean(
        bus.lengthMatchingPaths?.some((path) =>
          branchedConnections.has(path.connectionName),
        ),
      )
    )
  })
}

/** Keeps single-hop coupled routing, then matches exact lanes and bus roots. */
export class LengthMatchingPostProcessingSolver extends BaseSolver {
  private readonly differentialPairSolver: PostProcessingSolver
  private lengthMatchingSolver?: LengthMatchingSolver
  private outputHdRoutes?: HighDensityRoute[]
  private routedBusMatcher?: ReturnType<typeof createRoutedBusLengthSolver>
  private readonly lengthConstrainedSrj?: SimpleRouteJson

  constructor(
    private readonly params: LengthMatchingPostProcessingSolverParams,
  ) {
    super()
    const srj = params.originalSrj
    if (srj && needsRoutedBusLengthSolver(srj)) this.lengthConstrainedSrj = srj
    this.differentialPairSolver = new PostProcessingSolver({
      hdRoutes: params.hdRoutes,
      differentialPairs: params.differentialPairs,
      traces: params.traces,
      obstacles: params.obstacles,
      bounds: params.bounds,
      layerCount: params.layerCount,
      minTraceToPadEdgeClearance: params.obstacleMargin,
    })
    this.MAX_ITERATIONS =
      this.differentialPairSolver.MAX_ITERATIONS + 100_000 + 10
  }

  override getSolverName(): string {
    return "LengthMatchingPostProcessingSolver"
  }

  override getConstructorParams(): [LengthMatchingPostProcessingSolverParams] {
    return [this.params]
  }

  override _step(): void {
    if (this.routedBusMatcher) {
      this.routedBusMatcher.solver.step()
      if (this.routedBusMatcher.solver.failed) {
        this.failed = true
        this.error = this.routedBusMatcher.solver.error
      } else if (this.routedBusMatcher.solver.solved) {
        this.outputHdRoutes = this.routedBusMatcher.getMatchedHdRoutes()
        this.solved = true
      }
      return
    }
    const { connections = [] } = this.params
    const buses = this.lengthConstrainedSrj ? [] : (this.params.buses ?? [])
    if (!this.differentialPairSolver.solved) {
      this.differentialPairSolver.step()
      if (this.differentialPairSolver.failed) {
        this.failed = true
        this.error = this.differentialPairSolver.error
      }
      return
    }

    if (!this.lengthMatchingSolver) {
      const hdRoutes = this.differentialPairSolver.getOutput().hdRoutes
      const differentialPairs = [
        ...(this.params.differentialPairLanes ?? []),
        ...getBusLengthMatchingPairs(buses, hdRoutes),
      ]
      if (differentialPairs.length === 0) {
        this.finishPairMatching(hdRoutes)
        return
      }
      this.lengthMatchingSolver = new LengthMatchingSolver({
        hdRoutes,
        originalConnections: [
          ...connections,
          ...getLogicalLengthMatchingConnections(buses, connections),
        ],
        differentialPairs,
        traces: this.params.traces,
        obstacles: this.params.obstacles,
        bounds: this.params.bounds,
        layerCount: this.params.layerCount,
        obstacleMargin: this.params.obstacleMargin,
      })
      return
    }

    this.lengthMatchingSolver.step()
    if (this.lengthMatchingSolver.failed) {
      this.failed = true
      this.error = this.lengthMatchingSolver.error
      return
    }
    if (!this.lengthMatchingSolver.solved) return
    const hdRoutes = this.lengthMatchingSolver.getOutput().matchedHdRoutes
    assertBusLengthSkew(buses, hdRoutes)
    this.finishPairMatching(hdRoutes)
  }

  private finishPairMatching(hdRoutes: HighDensityRoute[]): void {
    const srj = this.lengthConstrainedSrj
    if (srj) {
      this.routedBusMatcher = createRoutedBusLengthSolver({
        srj,
        hdRoutes,
        fixedTraces: this.params.traces,
      })
      return
    }
    this.outputHdRoutes = hdRoutes
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
      this.routedBusMatcher?.solver.visualize() ??
      this.lengthMatchingSolver?.visualize() ??
      this.differentialPairSolver.visualize()
    )
  }
}
