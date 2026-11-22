import "../../fixtures/svg-matcher"
import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { PreparedPortPointRoutingSolver } from "tiny-hypergraph/lib/prepared/PreparedPortPointRoutingSolver"
import { getPreloadedSingleLayerCrossing } from "./getPreloadedSingleLayerCrossing"

test("replays Pipeline9 greedy finishing beside preloaded copper", async () => {
  const { topology, problem } = getPreloadedSingleLayerCrossing()
  const options = { OWNED_REGIONAL_HOP_FRONTIER: true }
  const parent = new PreparedPortPointRoutingSolver(topology, problem, options)
  const solver = parent["createGreedyFinalRouteSolver"](options, 0)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(
    solver.state.regionIntersectionCaches.reduce(
      (sum, cache) => sum + cache.existingSameLayerIntersections,
      0,
    ),
  ).toBe(0)
  for (const segment of problem.initialAssignments!) {
    expect(solver.state.regionSegments[segment.regionId]).toContainEqual([
      segment.routeId,
      segment.fromPortId,
      segment.toPortId,
    ])
  }
  await expect(
    getSvgFromGraphicsObject(solver.preview(), { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})
