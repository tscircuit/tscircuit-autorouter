import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"

test("Pipeline9 returns every pedometer route after a one-iteration graph budget", async () => {
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
  let tinySolver: TinyHyperGraphSolver | undefined
  while (!pipeline.portPointPathingSolver?.solved && !pipeline.failed) {
    pipeline.step()
    let active = pipeline.activeSubSolver
    while (active) {
      if (active instanceof TinyHyperGraphSolver) {
        tinySolver = active
        tinySolver.MAX_ITERATIONS = 1
      }
      active = active.activeSubSolver
    }
  }
  expect(pipeline.failed).toBe(false)
  expect(
    pipeline.portPointPathingSolver?.stats.approximationAfterIterationLimit,
  ).toBe(true)
  expect(tinySolver?.solved).toBe(true)
  expect(tinySolver?.failed).toBe(false)
  expect(tinySolver?.stats.acceptedBestSolutionOnTimeout).toBe(true)
  expect(tinySolver?.stats.initiallyRoutedRouteCount).toBe(230)
  expect(tinySolver?.getOutput().solvedRoutes).toHaveLength(230)
  expect(tinySolver?.state.unroutedRoutes).toEqual([])
  if (!tinySolver) {
    throw new Error("Pipeline9 did not create a tiny-hypergraph solver")
  }
  for (
    let regionId = 0;
    regionId < tinySolver.topology.regionCount;
    regionId++
  ) {
    for (const [routeId, fromPortId, toPortId] of tinySolver.state
      .regionSegments[regionId]) {
      const netId = tinySolver.problem.routeNet[routeId]
      expect(tinySolver.state.portAssignment[fromPortId]).toBe(netId)
      expect(tinySolver.state.portAssignment[toPortId]).toBe(netId)
      const reservedNetId = tinySolver.problem.regionNetId[regionId]
      expect(reservedNetId === -1 || reservedNetId === netId).toBe(true)
    }
  }
  const svg = getSvgFromGraphicsObject(tinySolver.visualize(), {
    backgroundColor: "white",
  })
  // The renderer's embedded script includes trailing whitespace.
  await expect(svg.replace(/[ \t]+$/gm, "")).toMatchSvgSnapshot(
    import.meta.path,
  )

  // A complete seed must remain eligible for refinement, unlike caller-owned
  // preloaded copper that is restored by the stable-assignment solver.
  tinySolver.resetRoutingStateForRerip()
  expect(tinySolver.state.unroutedRoutes).toHaveLength(230)
})
