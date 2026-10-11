import { DuplicateCongestedPortSolver } from "tiny-hypergraph/lib/DuplicateCongestedPortSolver"
import { loadSerializedHyperGraph } from "tiny-hypergraph/lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver, type TinyHyperGraphProblem } from "tiny-hypergraph/lib/core"
import type { TinyBitsetRegionCost } from "./TinyBitsetRegionCostCache"
import { TinyIndependentRegionCostIndex } from "./TinyIndependentRegionCostIndex"

type RegionCostHost = { computeRegionCostForRegion: TinyBitsetRegionCost }
export type IndependentDuplicateRouteDiagnostic = {
  routeId: number
  iterations: number
  maxIterations: number
  solved: boolean
  failed: boolean
}

/** Preserve duplicate discovery's native single-route search and workspace reuse. */
export class ParallelDuplicateCongestedPortSolver extends DuplicateCongestedPortSolver {
  readonly routeDiagnostics: IndependentDuplicateRouteDiagnostic[] = []
  collectCostIndexDiagnostics = false
  readonly costIndexDiagnostics = { hits: 0, misses: 0 }

  private getIndexedPortUseCounts(): Map<string, number> {
    const { topology, problem } = loadSerializedHyperGraph(this.serializedHyperGraph)
    if (this.options.useSerializedPortPenalties === false) problem.portPenalty = undefined
    const portUseCounts = new Map<string, number>()
    let routeSolver: TinyHyperGraphSolver | undefined
    let costIndex: TinyIndependentRegionCostIndex | undefined
    for (let routeId = 0; routeId < problem.routeCount; routeId++) {
      const routeProblem: TinyHyperGraphProblem = {
        routeCount: 1, portSectionMask: problem.portSectionMask,
        routeMetadata: problem.routeMetadata === undefined ? undefined : [problem.routeMetadata[routeId]],
        routeStartPort: Int32Array.from([problem.routeStartPort[routeId]]),
        routeEndPort: Int32Array.from([problem.routeEndPort[routeId]]),
        routeNet: Int32Array.from([problem.routeNet[routeId]]),
        regionNetId: problem.regionNetId, portPenalty: problem.portPenalty,
      }
      if (routeSolver) routeSolver.resetForProblem(routeProblem)
      else {
        routeSolver = new TinyHyperGraphSolver(topology, routeProblem, {
          RIP_THRESHOLD_RAMP_ATTEMPTS: 0, STATIC_REACHABILITY_PRECHECK: false,
          ...this.options.routeSolveOptions,
        })
        // Keep the actual base instance: resetForProblem rejects subclasses.
        // Only the pure region-cost evaluation is indexed; computeG remains native.
        const host = routeSolver as unknown as RegionCostHost
        costIndex = new TinyIndependentRegionCostIndex(routeSolver, host.computeRegionCostForRegion.bind(routeSolver))
        costIndex.collectDiagnostics = this.collectCostIndexDiagnostics
        host.computeRegionCostForRegion = costIndex.get.bind(costIndex)
      }
      if (!costIndex) throw new Error("Independent duplicate route is missing its region-cost index")
      costIndex.reset()
      routeSolver.solve()
      this.routeDiagnostics.push({ routeId, iterations: routeSolver.iterations,
        maxIterations: routeSolver.MAX_ITERATIONS, solved: routeSolver.solved, failed: routeSolver.failed })
      if (!routeSolver.solved || routeSolver.failed) {
        throw new Error(`Route ${routeId} could not be solved independently: ${routeSolver.error ?? "unknown error"}`)
      }
      const usedPortIds = new Set<number>()
      for (const segments of routeSolver.state.regionSegments) {
        for (const [, fromPortId, toPortId] of segments) {
          usedPortIds.add(fromPortId)
          usedPortIds.add(toPortId)
        }
      }
      if (usedPortIds.size === 0 && routeSolver.problem.routeCount === 1) {
        usedPortIds.add(routeSolver.problem.routeStartPort[0]!)
        usedPortIds.add(routeSolver.problem.routeEndPort[0]!)
      }
      for (const portId of usedPortIds) {
        const metadata = topology.portMetadata?.[portId]
        const record = typeof metadata === "object" && metadata !== null
          ? metadata as { serializedPortId?: unknown; portId?: unknown } : undefined
        const serializedId = typeof record?.serializedPortId === "string" ? record.serializedPortId
          : typeof record?.portId === "string" ? record.portId : `port-${portId}`
        portUseCounts.set(serializedId, (portUseCounts.get(serializedId) ?? 0) + 1)
      }
    }
    if (costIndex) Object.assign(this.costIndexDiagnostics, costIndex.diagnostics)
    return portUseCounts
  }

  override _setup(): void {
    try {
      this.revisedSerializedHyperGraph = this.duplicateCongestedPorts(this.getIndexedPortUseCounts())
      this.stats = { ...this.stats,
        duplicateSourcePortCount: this.report.duplicatedPorts.length,
        duplicatedPortCount: this.report.duplicatedPorts.reduce((sum, port) => sum + port.duplicatePortIds.length, 0),
        independentRouteCount: this.routeDiagnostics.length,
        independentRouteIterations: this.routeDiagnostics.reduce((sum, route) => sum + route.iterations, 0),
      }
      this.solved = true
    } catch (error) {
      this.failed = true
      this.error = error instanceof Error ? error.message : String(error)
    }
  }
}
