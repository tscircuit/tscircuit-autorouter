import { SolverRuntime } from "@tscircuit/solver-utils"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { TinyHyperGraphSectionPipelineInput, TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import { createStaticallyUnroutableRouteSummary, getStaticallyUnroutableRoutes } from "tiny-hypergraph/lib/static-reachability"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { TinyHyperGraphSectionPipelineWithTerminalNetIds } from "./TinyHypergraphPortPointPathingSolver"

type SpatialWarmStartInput = {
  graph: SerializedHyperGraph
  solveGraphOptions: TinyHyperGraphSectionPipelineInput["solveGraphOptions"]
  sectionSolverOptions: TinyHyperGraphSectionPipelineInput["sectionSolverOptions"]
}

type SpatialWarmStartOutput = {
  assignmentsByRegion: Array<{
    regionId: string
    assignments: NonNullable<SerializedHyperGraph["regions"][number]["assignments"]>
  }>
  completedRoutes: number
  attemptedRoutes: number
  exhausted: boolean
  error: string | null
}

/** Produce optional, spatially isolated initial routes for the full graph solve. */
export class TinyHypergraphSpatialWarmStartSolver extends BaseSolver {
  static readonly solverName = "TinyHypergraphSpatialWarmStartSolver"
  private output?: SpatialWarmStartOutput

  constructor(private readonly input: SpatialWarmStartInput) {
    super()
  }

  override _step(): void {
    const pipeline = new TinyHyperGraphSectionPipelineWithTerminalNetIds(
      {
        serializedHyperGraph: this.input.graph,
        createSectionMask: ({ topology }) => new Int8Array(topology.portCount),
        solveGraphOptions: { ...this.input.solveGraphOptions, MAX_ITERATIONS: 100_000 },
        sectionSolverOptions: this.input.sectionSolverOptions,
      },
      true,
      true,
    )
    // A partition proposes completed routes within a fixed budget. The full
    // graph solver always handles the remainder and may reroute these proposals.
    pipeline.step()
    const solver = pipeline.getSolver<TinyHyperGraphSolver>("solveGraph")
    if (!solver) throw new Error("Spatial warm start did not initialize graph routing")
    // Clipping the graph can make some endpoints unreachable. Exclude those
    // candidates before solving; the full graph still routes every connection.
    const unreachable = getStaticallyUnroutableRoutes({
      topology: solver.topology,
      problem: solver.problem,
      problemSetup: solver.problemSetup,
      portAssignment: solver.state.portAssignment,
      routeIds: solver.state.unroutedRoutes,
      maxPrecheckHops: solver.STATIC_REACHABILITY_PRECHECK_MAX_HOPS,
      getStartingNextRegionId: (routeId, portId) => solver.getStartingNextRegionId(routeId, portId),
      getRouteSummary: (routeId) => createStaticallyUnroutableRouteSummary({ problem: solver.problem, routeId }),
    })
    const excluded = new Set(unreachable.map(({ routeId }) => routeId))
    solver.state.unroutedRoutes = solver.state.unroutedRoutes.filter((routeId) => !excluded.has(routeId))
    while (!solver.solved && !solver.failed && solver.iterations < 50_000) {
      solver.step()
    }

    if (solver.failed) {
      throw new Error(`Spatial warm-start solver failed: ${solver.error}`)
    }
    const assignmentsByRegion: SpatialWarmStartOutput["assignmentsByRegion"] = []
    const unrouted = new Set(solver.state.unroutedRoutes)
    const completedRouteIds = new Set<number>()
    const regionMetadata = solver.topology.regionMetadata
    const portMetadata = solver.topology.portMetadata
    for (let regionId = 0; regionId < solver.topology.regionCount; regionId++) {
      const regionName = regionMetadata?.[regionId]?.serializedRegionId
      if (typeof regionName !== "string") throw new Error("Spatial region is missing its serialized ID")
      const assignments: SpatialWarmStartOutput["assignmentsByRegion"][number]["assignments"] = []
      for (const [routeId, fromPort, toPort] of solver.state.regionSegments[regionId]!) {
        if (excluded.has(routeId) || unrouted.has(routeId) || solver.state.currentRouteId === routeId) continue
        const connectionId = solver.problem.routeMetadata?.[routeId]?.connectionId
        const from = portMetadata?.[fromPort]?.serializedPortId
        const to = portMetadata?.[toPort]?.serializedPortId
        if (typeof connectionId !== "string" || typeof from !== "string" || typeof to !== "string") {
          throw new Error("Spatial assignment is missing serialized IDs")
        }
        assignments.push({ connectionId, regionPort1Id: from, regionPort2Id: to })
        completedRouteIds.add(routeId)
      }
      if (assignments.length) assignmentsByRegion.push({ regionId: regionName, assignments })
    }
    this.output = {
      assignmentsByRegion,
      completedRoutes: completedRouteIds.size,
      attemptedRoutes: solver.problem.routeCount,
      exhausted: !solver.solved,
      error: solver.error ?? null,
    }
    this.solved = true
  }

  getOutput(): SpatialWarmStartOutput {
    if (!this.output) throw new Error("Spatial warm start has not completed")
    return this.output
  }
}

SolverRuntime.registerSolver(TinyHypergraphSpatialWarmStartSolver)
