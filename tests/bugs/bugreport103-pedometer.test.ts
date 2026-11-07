import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"

test("Pipeline9 completes the pedometer graph at low effort", async () => {
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
      if (active instanceof TinyHyperGraphSolver) tinySolver = active
      active = active.activeSubSolver
    }
  }

  expect(pipeline.failed).toBe(false)
  expect(pipeline.portPointPathingSolver?.solved).toBe(true)
  if (!tinySolver) {
    throw new Error("Pipeline9 did not create a tiny-hypergraph solver")
  }
  expect(tinySolver.failed).toBe(false)
  expect(tinySolver.solved).toBe(true)
  expect(tinySolver.iterations).toBe(tinySolver.MAX_ITERATIONS)
  expect(tinySolver.stats.acceptedGreedyFinalRouteOnTimeout).toBe(true)
  expect(tinySolver.getOutput().solvedRoutes).toHaveLength(
    tinySolver.problem.routeCount,
  )
  expect(tinySolver.state.unroutedRoutes).toEqual([])
  // Connected pour tiles remove redundant airwires, but every original
  // terminal must still be represented in the routing problem.
  const pairedTerminalIds = new Set(
    pipeline.srjWithPointPairs!.connections.flatMap((connection) =>
      connection.pointsToConnect.map((point) => point.pointId),
    ),
  )
  for (const connection of srj.connections) {
    for (const point of connection.pointsToConnect) {
      expect(pairedTerminalIds.has(point.pointId)).toBe(true)
    }
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
  await expect(svg.replace(/[ \t]+$/gm, "")).toMatchSvgSnapshot(
    import.meta.path,
  )
})
