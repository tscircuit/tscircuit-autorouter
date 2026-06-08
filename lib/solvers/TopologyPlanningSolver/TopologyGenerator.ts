import type { BaseSolver } from "@tscircuit/solver-utils"
import type { DetectedComponent } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import type { ComponentKind } from "lib/solvers/ComponentDetectionSolver/detectors/types"
import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"

/** Shared input passed into each component-specific topology generator. */
export interface TopologyGeneratorSolverParams {
  inputSrj: SimpleRouteJson
  detectedComponent: DetectedComponent
  componentId?: string
  replacementObstacleId?: string
  viaDiameter?: number
  obstacleMargin?: number
}

/** Shared output collected from each component-specific topology generator. */
export interface TopologyGeneratorSolverOutput {
  obstacles: Obstacle[]
  routingRegions: CapacityMeshNode[]
}

export type TopologyGeneratorSolver = BaseSolver & {
  getOutput(): TopologyGeneratorSolverOutput
}

export interface TopologyGeneratorClass {
  readonly componentKind: ComponentKind
  new (params: TopologyGeneratorSolverParams): TopologyGeneratorSolver
}

// biome-ignore lint/complexity/noStaticOnlyClass: Registry API used by topology generator classes.
export class TopologyGenerator {
  private static readonly generators = new Map<
    ComponentKind,
    TopologyGeneratorClass
  >()

  /**
   * Registers the solver class that owns a specific component kind.
   *
   * @param generatorClass - Solver class with a static `componentKind`.
   * @returns Nothing. The class is stored in the shared registry.
   * @note Later registrations replace earlier ones for the same component kind.
   */
  static register(generatorClass: TopologyGeneratorClass) {
    TopologyGenerator.generators.set(
      generatorClass.componentKind,
      generatorClass,
    )
  }

  /**
   * Creates the topology generator that matches the detected component kind.
   *
   * @param componentKind - Concrete detected component kind to instantiate.
   * @param params - Shared solver input forwarded into the generator constructor.
   * @returns A topology generator solver instance for `componentKind`.
   * @caution Built-in registrations must run before calling this factory.
   */
  static create(
    componentKind: ComponentKind,
    params: TopologyGeneratorSolverParams,
  ): TopologyGeneratorSolver {
    const generatorClass = TopologyGenerator.generators.get(componentKind)

    if (!generatorClass) {
      throw new Error(
        `No topology generator registered for component kind "${componentKind}"`,
      )
    }

    return new generatorClass(params)
  }
}
