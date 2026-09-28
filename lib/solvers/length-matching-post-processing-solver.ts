import {
  LengthMatchingSolver,
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
} from "lib/types/srj-types"
import { BaseSolver } from "./BaseSolver"

type InitialRoutingSolver = BaseSolver & {
  getCurrentPhase(): string
  _getOutputHdRoutes(): HighDensityRoute[]
  netToPointPairsSolver?: { newConnections: SimpleRouteConnection[] }
}

type LengthMatchingPostProcessingSolverParams = {
  initialRoutingSolver?: InitialRoutingSolver
  hdRoutes: HighDensityRoute[]
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

const assertDifferentialPairLengthSkew = (
  pairs: DifferentialPair[],
  routes: HighDensityRoute[],
): void => {
  for (const pair of pairs) {
    const lengths = pair.connectionNames.map((connectionName) => {
      const matches = routes.filter(
        (route) => route.connectionName === connectionName,
      )
      if (matches.length !== 1)
        throw new Error(
          `Length matching: differential pair connection "${connectionName}" must have exactly one final route, got ${matches.length}`,
        )
      const route = matches[0]!
      return route.route.slice(1).reduce((length, point, index) => {
        const previous = route.route[index]!
        return length + Math.hypot(point.x - previous.x, point.y - previous.y)
      }, 0)
    })
    const skew = Math.abs(lengths[0]! - lengths[1]!)
    if (skew > pair.lengthTolerance + 1e-6)
      throw new Error(
        `Length matching: differential pair "${pair.connectionNames.join("/")}" routed length skew ${skew.toFixed(4)}mm exceeds ${pair.lengthTolerance.toFixed(4)}mm`,
      )
  }
}

/** Runs existing differential-pair post-processing, then tunes bus roots. */
export class LengthMatchingPostProcessingSolver extends BaseSolver {
  private differentialPairSolver?: PostProcessingSolver
  private resolvedDifferentialPairs: DifferentialPair[] = []
  private outputConnections: SimpleRouteConnection[] = []
  private busLengthMatchingSolver?: LengthMatchingSolver
  private outputHdRoutes?: HighDensityRoute[]

  constructor(
    private readonly params: LengthMatchingPostProcessingSolverParams,
  ) {
    super()
    this.MAX_ITERATIONS =
      (params.initialRoutingSolver?.MAX_ITERATIONS ?? 0) + 100_000_000
  }

  private initializeDifferentialPairSolver(): void {
    const initialRoutingSolver = this.params.initialRoutingSolver
    const hdRoutes = initialRoutingSolver
      ? initialRoutingSolver._getOutputHdRoutes()
      : this.params.hdRoutes
    if (initialRoutingSolver && !initialRoutingSolver.netToPointPairsSolver)
      throw new Error("Length matching: initial routing produced no point pairs")
    this.outputConnections = initialRoutingSolver
      ? initialRoutingSolver.netToPointPairsSolver!.newConnections
      : this.params.connections.filter((connection) =>
          hdRoutes.some((route) => route.connectionName === connection.name),
        )
    const differentialPairs = this.params.differentialPairs.map((pair) => {
      if (!initialRoutingSolver) return pair
      const connectionNames = pair.connectionNames.map((connectionName) => {
        const matches = this.outputConnections.filter(
          (connection) =>
            connection.name === connectionName ||
            connection.__rootConnectionNames?.includes(connectionName) ||
            connection.__netConnectionName === connectionName,
        )
        if (matches.length !== 1)
          throw new Error(
            `Length matching: differential pair connection "${connectionName}" must resolve to exactly one point-pair connection, got ${matches.length}`,
          )
        return matches[0]!.name
      }) as [string, string]
      if (connectionNames[0] === connectionNames[1])
        throw new Error(
          `Length matching: differential pair ${pair.connectionNames.join("/")} resolves to the same connection`,
        )
      const resolvedPair = { ...pair, connectionNames }
      if (pair.traceGap === undefined) return resolvedPair
      const pairRoutes = connectionNames.map((connectionName) => {
        const matches = hdRoutes.filter(
          (route) => route.connectionName === connectionName,
        )
        if (matches.length !== 1)
          throw new Error(
            `Length matching: differential pair connection "${connectionName}" must have exactly one HD route, got ${matches.length}`,
          )
        return matches[0]!
      })
      const centerlineDistance = pair.traceGap + pairRoutes.reduce(
        (sum, route) => sum + route.traceThickness / 2,
        0,
      )
      return {
        ...resolvedPair,
        minimumCenterlineDistance: centerlineDistance,
        maximumCenterlineDistance: centerlineDistance,
      }
    })
    this.resolvedDifferentialPairs = differentialPairs
    this.differentialPairSolver = new PostProcessingSolver({
      hdRoutes,
      differentialPairs,
      traces: this.params.traces,
      obstacles: this.params.obstacles,
      bounds: this.params.bounds,
      layerCount: this.params.layerCount,
      minTraceToPadEdgeClearance: this.params.obstacleMargin,
    })
    this.MAX_ITERATIONS = Math.max(
      this.MAX_ITERATIONS,
      this.iterations + this.differentialPairSolver.MAX_ITERATIONS + 100_010,
    )
  }

  override getSolverName(): string {
    return "LengthMatchingPostProcessingSolver"
  }

  override _step(): void {
    const initialRoutingSolver = this.params.initialRoutingSolver
    if (initialRoutingSolver) {
      if (initialRoutingSolver.solved)
        throw new Error(
          "Length matching: initial routing completed past its joint DRC boundary",
        )
      // Initial routing supplies geometry through global DRC. Joint repair and
      // power expansion belong to the outer pipeline after constrained copper
      // is fixed and the remaining connections have been routed.
      if (initialRoutingSolver.getCurrentPhase() !== "pipeline9JointDrcRepairSolver") {
        initialRoutingSolver.step()
        if (initialRoutingSolver.failed) {
          this.failed = true
          this.error = initialRoutingSolver.error
        }
        return
      }
    }
    if (!this.differentialPairSolver) this.initializeDifferentialPairSolver()
    const differentialPairSolver = this.differentialPairSolver!
    if (!differentialPairSolver.solved) {
      differentialPairSolver.step()
      if (differentialPairSolver.failed) {
        this.failed = true
        this.error = differentialPairSolver.error
      }
      return
    }

    if (!this.busLengthMatchingSolver) {
      const hdRoutes = differentialPairSolver.getOutput().hdRoutes
      const differentialPairs = getBusLengthMatchingPairs(
        this.params.buses,
        hdRoutes,
      )
      if (differentialPairs.length === 0) {
        assertDifferentialPairLengthSkew(this.resolvedDifferentialPairs, hdRoutes)
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
    assertDifferentialPairLengthSkew(
      this.resolvedDifferentialPairs,
      this.outputHdRoutes,
    )
    this.solved = true
  }

  getOutput(): { hdRoutes: HighDensityRoute[] } {
    if (!this.solved || !this.outputHdRoutes)
      throw new Error(
        "LengthMatchingPostProcessingSolver output requested before completion",
      )
    return { hdRoutes: this.outputHdRoutes }
  }

  getOutputConnections(): SimpleRouteConnection[] {
    if (!this.solved)
      throw new Error(
        "LengthMatchingPostProcessingSolver connections requested before completion",
      )
    return this.outputConnections
  }

  override visualize(): GraphicsObject {
    return (
      this.busLengthMatchingSolver?.visualize() ??
      this.differentialPairSolver?.visualize() ??
      this.params.initialRoutingSolver?.visualize() ??
      super.visualize()
    )
  }
}
