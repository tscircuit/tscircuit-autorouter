import { BaseSolver } from "lib/solvers/BaseSolver"
import type { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { ParallelPortfolioSingleIntraNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPortfolioSingleIntraNodeSolver"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "lib/types/high-density-types"

export function createFirstValidNode(): NodeWithPortPoints {
  return {
    capacityMeshNodeId: "first-valid-physical", center: { x: 0, y: 0 }, width: 6, height: 6,
    availableZ: [0, 1], portPoints: [
      { connectionName: "signal", rootConnectionName: "signal_root", x: -2, y: 0, z: 0 },
      { connectionName: "signal", rootConnectionName: "signal_root", x: 2, y: 0, z: 0 },
    ],
  }
}

export function createFirstValidRoute(node: NodeWithPortPoints, traceWidth = 0.15): HighDensityIntraNodeRoute {
  const first = node.portPoints[0]!
  const last = node.portPoints[1]!
  return {
    connectionName: first.connectionName, traceThickness: traceWidth, viaDiameter: 0.3,
    route: [{ x: first.x, y: first.y, z: first.z }, { x: last.x, y: last.y, z: last.z }],
    vias: [],
  }
}

export class FirstValidGenericSolver extends BaseSolver {
  finish = false
  solvedRoutes: HighDensityIntraNodeRoute[] = []

  constructor(readonly routes: HighDensityIntraNodeRoute[]) {
    super()
    this.MAX_ITERATIONS = 100_000
    this.progress = 0
  }

  override _step(): void {
    if (this.finish) {
      this.solvedRoutes = this.routes
      this.solved = true
      this.progress = 1
    }
  }
}

export class FirstValidTestPortfolio extends ParallelPortfolioSingleIntraNodeSolver {
  generic?: FirstValidGenericSolver
  includeGeneric = true

  override getCombinationDefs(): string[][] {
    const definitions = super.getCombinationDefs()
    const heads = definitions.filter((definition) => definition.includes("multiHeadPolyLine"))
    if (heads.length !== 1) {
      throw new Error("Expected the two original multi-head candidates")
    }
    return this.includeGeneric ? [...heads, ["testGeneric"]] : heads
  }

  override getHyperParameterDefs(): ReturnType<ParallelPortfolioSingleIntraNodeSolver["getHyperParameterDefs"]> {
    const definitions = super.getHyperParameterDefs()
    const generic = { name: "testGeneric", possibleValues: [{ TEST_GENERIC: true }] }
    if (definitions.some((definition) => definition.name === generic.name)) {
      throw new Error("Generic fixture collides with an existing portfolio strategy")
    }
    return [...definitions, generic as unknown as typeof definitions[number]]
  }

  override generateSolver(hyperParameters: Record<string, any>): IntraNodeRouteSolver {
    if (!hyperParameters.TEST_GENERIC) return super.generateSolver(hyperParameters)
    this.generic = new FirstValidGenericSolver([
      createFirstValidRoute(this.nodeWithPortPoints, this.constructorParams.traceWidth ?? 0.15),
    ])
    return this.generic as unknown as IntraNodeRouteSolver
  }
}
