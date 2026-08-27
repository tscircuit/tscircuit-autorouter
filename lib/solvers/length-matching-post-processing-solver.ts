import {
  LengthMatchingSolver,
  PostProcessingSolver,
} from "@tscircuit/length-matching-solver"
import type { GraphicsObject } from "graphics-debug"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type {
  DifferentialPair,
  Obstacle,
  SimpleRouteBus,
  SimpleRouteConnection,
} from "lib/types/srj-types"
import { BaseSolver } from "./BaseSolver"

type LengthMatchingPostProcessingSolverParams = {
  hdRoutes: HighDensityRoute[]
  differentialPairs: DifferentialPair[]
  buses: SimpleRouteBus[]
  connections: SimpleRouteConnection[]
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

/** Runs existing differential-pair post-processing, then tunes bus roots. */
export class LengthMatchingPostProcessingSolver extends BaseSolver {
  private readonly differentialPairSolver: PostProcessingSolver
  private busLengthMatchingSolver?: LengthMatchingSolver
  private outputHdRoutes?: HighDensityRoute[]

  constructor(
    private readonly params: LengthMatchingPostProcessingSolverParams,
  ) {
    super()
    this.differentialPairSolver = new PostProcessingSolver({
      hdRoutes: params.hdRoutes,
      differentialPairs: params.differentialPairs,
      obstacles: params.obstacles,
      bounds: params.bounds,
      layerCount: params.layerCount,
    })
    this.MAX_ITERATIONS =
      this.differentialPairSolver.MAX_ITERATIONS + 100_000 + 10
  }

  override getSolverName(): string {
    return "LengthMatchingPostProcessingSolver"
  }

  override _step(): void {
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
      this.differentialPairSolver.visualize()
    )
  }
}
