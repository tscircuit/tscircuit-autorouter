import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import type { HgPortPointPathingSolverParams } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import { TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"

test("Pipeline9 rejects a pedometer timeout with illegal single-layer crossings", async () => {
  const srj: SimpleRouteJson = await Bun.file(
    new URL(
      "../../public/fixtures/bugreport103-pedometer.srj.json",
      import.meta.url,
    ),
  ).json()
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    effort: 0.01,
    cacheProvider: null,
  })
  // This regression exercises binding layer masks, not legacy layer hints.
  const pathing = pipeline.pipelineDef.find(
    (step) => step.solverName === "portPointPathingSolver",
  )!
  const getParams = pathing.getConstructorParams
  pathing.getConstructorParams = (cms) => {
    const [params] = getParams(cms) as [HgPortPointPathingSolverParams]
    return [{ ...params, regionLayerMasksAreBinding: true }]
  }
  let tinySolver: TinyHyperGraphSolver | undefined
  while (!pipeline.portPointPathingSolver?.solved && !pipeline.failed) {
    pipeline.step()
    let active = pipeline.activeSubSolver
    while (active) {
      if (active instanceof TinyHyperGraphSolver) tinySolver = active
      active = active.activeSubSolver
    }
  }

  expect(pipeline.failed).toBe(true)
  expect(pipeline.portPointPathingSolver?.solved).toBe(false)
  if (!tinySolver) {
    throw new Error("Pipeline9 did not create a tiny-hypergraph solver")
  }
  expect(tinySolver.failed).toBe(true)
  expect(tinySolver.solved).toBe(false)
  expect(tinySolver.iterations).toBe(tinySolver.MAX_ITERATIONS)
  // The old greedy override bypassed hard checks, including 83 forced
  // boundary-chord crossings. An incomplete graph is not a routed board.
  expect(tinySolver.stats.acceptedGreedyFinalRouteOnTimeout).not.toBe(true)
  expect(tinySolver.state.unroutedRoutes.length).toBeGreaterThan(0)
  for (
    let regionId = 0;
    regionId < tinySolver.topology.regionCount;
    regionId++
  ) {
    const mask = tinySolver.topology.regionAvailableZMask?.[regionId] ?? 0
    if (mask > 0 && (mask & (mask - 1)) === 0) {
      expect(
        tinySolver.state.regionIntersectionCaches[regionId]
          .existingSameLayerIntersections,
      ).toBe(0)
    }
    for (const [routeId, fromPortId, toPortId] of tinySolver.state
      .regionSegments[regionId]) {
      const netId = tinySolver.problem.routeNet[routeId]
      expect(tinySolver.state.portAssignment[fromPortId]).toBe(netId)
      expect(tinySolver.state.portAssignment[toPortId]).toBe(netId)
      const reservedNetId = tinySolver.problem.regionNetId[regionId]
      expect(reservedNetId === -1 || reservedNetId === netId).toBe(true)
    }
  }
})
