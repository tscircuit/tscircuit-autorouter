import type { GraphicsObject } from "graphics-debug"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type {
  DifferentialPair,
  SimpleRouteConnection,
} from "lib/types/srj-types"
import { BaseSolver } from "../BaseSolver"

export type LengthMatchingSolverParams = {
  hdRoutes: HighDensityRoute[]
  originalConnections: SimpleRouteConnection[]
  differentialPairs?: DifferentialPair[]
}

/**
 * Applies SRJ length-matching constraints to simplified routes.
 *
 * TODO: Generate collision-free grid/meander detours for each constrained
 * pair. Match routed output by `rootConnectionName ?? connectionName`, then
 * verify each pair against its tolerance.
 */
export class LengthMatchingSolver extends BaseSolver {
  override getSolverName(): string {
    return "LengthMatchingSolver"
  }

  matchedHdRoutes: HighDensityRoute[]

  constructor(private readonly params: LengthMatchingSolverParams) {
    super()
    this.matchedHdRoutes = params.hdRoutes
  }

  override _step(): void {
    const connectionsByName = new Map(
      this.params.originalConnections.map((connection) => [
        connection.name,
        connection,
      ]),
    )

    for (const pair of this.params.differentialPairs ?? []) {
      if (pair.connectionNames[0] === pair.connectionNames[1]) {
        throw new Error(
          "LengthMatchingSolver: a differential pair must reference two distinct connections",
        )
      }
      if (!Number.isFinite(pair.lengthTolerance) || pair.lengthTolerance < 0) {
        throw new Error(
          "LengthMatchingSolver: differential pair lengthTolerance must be a non-negative finite number",
        )
      }
      for (const connectionName of pair.connectionNames) {
        const connection = connectionsByName.get(connectionName)
        if (!connection) {
          throw new Error(
            `LengthMatchingSolver: differential pair references unknown connection "${connectionName}"`,
          )
        }
        if (connection.pointsToConnect.length !== 2) {
          throw new Error(
            `LengthMatchingSolver: differential pair connection "${connectionName}" must have exactly two points before MST splitting`,
          )
        }
      }
    }

    // TODO: Match pairs with grid-style length-tuning detours.
    this.solved = true
  }

  override getConstructorParams(): [LengthMatchingSolverParams] {
    return [this.params]
  }

  override visualize(): GraphicsObject {
    return { lines: [], points: [], rects: [], circles: [] }
  }
}
