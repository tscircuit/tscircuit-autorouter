import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../../fixtures/getLastStepSvg"
import { simpleRouteJson } from "../../../fixtures/features/off-board-obstacles/off-board-assignable.fixture"
import { AssignableAutoroutingPipeline2 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline2/AssignableAutoroutingPipeline2"

test("routes with assignable off-board obstacles between pads", () => {
  const solver = new AssignableAutoroutingPipeline2(
    simpleRouteJson as SimpleRouteJson,
    {
      cacheProvider: null,
      forceOffBoardConnectionNames: ["AD_NET"],
    },
  )
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const prefabTransitions =
    solver.portPointPathingSolver!.hypergraphSolver!.solvedRoutes.flatMap(
      (route) =>
        route.path.filter((candidate) =>
          Boolean(candidate.lastRegion?.d._offBoardConnectionId),
        ),
    )
  expect(prefabTransitions).toHaveLength(1)
  expect(
    prefabTransitions[0]!.lastPort!.d.offBoardEndpointCapacityMeshNodeId,
  ).not.toBe(prefabTransitions[0]!.port.d.offBoardEndpointCapacityMeshNodeId)
  expect(solver.getOutputSimplifiedPcbTraces()).toHaveLength(2)

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
