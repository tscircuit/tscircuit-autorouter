import { expect, test } from "bun:test"
import { installParallelIntraNodeGridKernel } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/installParallelHighDensityGridKernel"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("worker grid kernel preserves all sample001 and003 original HD routes and actual search work", async (): Promise<void> => {
  const originalFactory = PortfolioSingleIntraNodeSolver.prototype.generateSolver
  const originalStep = SingleHighDensityRouteSolver.prototype._step
  let usePacked = false
  let counts = { searches: 0, expansions: 0, proposed: 0, accepted: 0, pops: 0 }
  const seen = new WeakSet<SingleHighDensityRouteSolver>()
  PortfolioSingleIntraNodeSolver.prototype.generateSolver = function (parameters) {
    const solver = originalFactory.call(this, parameters)
    return usePacked && solver instanceof CachedIntraNodeRouteSolver
      ? installParallelIntraNodeGridKernel(solver) : solver
  }
  SingleHighDensityRouteSolver.prototype._step = function (): void {
    if (!seen.has(this)) {
      seen.add(this)
      counts.searches++
      const neighbors = this.getNeighbors.bind(this)
      this.getNeighbors = (node) => {
        const result = neighbors(node)
        counts.expansions++
        counts.proposed += 8 + this.availableZ.filter((z) => z !== node.z).length
        counts.accepted += result.length
        return result
      }
      const dequeue = this.candidates.dequeue.bind(this.candidates)
      this.candidates.dequeue = () => { counts.pops++; return dequeue() }
    }
    originalStep.call(this)
  }
  try {
    for (const sample of [1, 3]) {
      getGlobalInMemoryCache().clearCache()
      const { scenario } = await loadScenarioBySampleNumber("srj18", sample)
      const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(scenario), { effort: 1, cacheProvider: null })
      pipeline.solveUntilPhase("highDensityRouteSolver")
      const definition = pipeline.pipelineDef.find((step) => step.solverName === "highDensityRouteSolver")!
      const params = (definition.getConstructorParams(pipeline) as [Pipeline9HighDensitySolverParams])[0]
      const results = [false, true].map((packed) => {
        usePacked = packed
        counts = { searches: 0, expansions: 0, proposed: 0, accepted: 0, pops: 0 }
        getGlobalInMemoryCache().clearCache()
        const solver = new Pipeline9HighDensitySolver({ ...params, nodePortPoints: structuredClone(params.nodePortPoints) })
        solver.solve()
        return { solver, work: { ...counts } }
      })
      const native = results[0]!
      const packed = results[1]!
      expect(native.solver.solved, native.solver.error ?? "").toBe(true)
      expect(packed.solver.solved, packed.solver.error ?? "").toBe(true)
      expect(packed.solver.routes).toEqual(native.solver.routes)
      expect(packed.solver.stats).toEqual(native.solver.stats)
      expect(packed.work).toEqual(native.work)
      expect(packed.work.expansions).toBeGreaterThan(500_000)
      expect(packed.work.proposed - packed.work.accepted).toBeGreaterThan(2_000_000)
    }
  } finally {
    PortfolioSingleIntraNodeSolver.prototype.generateSolver = originalFactory
    SingleHighDensityRouteSolver.prototype._step = originalStep
    getGlobalInMemoryCache().clearCache()
  }
})
