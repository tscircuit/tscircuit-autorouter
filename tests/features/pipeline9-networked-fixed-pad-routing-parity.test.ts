import { expect, test } from "bun:test"
import { AUTOROUTER_VERSION } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/autorouterVersion"
import { Pipeline9NetworkedHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/Pipeline9NetworkedHighDensitySolver"
import type { Pipeline9NetworkedHighDensityNodeInput } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9NetworkedTypes"
import { solvePipeline9NetworkedHighDensityNode } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/solvePipeline9NetworkedHighDensityNode"
import { createPipeline9RegularNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { createNetworkFixedPadProblem } from "../fixtures/createNetworkFixedPadProblem"

test("network projection preserves ordinary fixed-pad routing when foreign owners are absent from projected connectivity", (): void => {
  const { node, connMap, obstacles, fixedPadClearance } =
    createNetworkFixedPadProblem()
  const params = {
    connMap,
    colorMap: {},
    viaDiameter: 0.3,
    traceWidth: 0.2,
    obstacleMargin: 0.1,
    effort: 1,
    nodePfById: { "physical-corner-node": null },
    obstacles,
    layerCount: 2,
    fixedPadClearance,
  }
  const fullSolver = createPipeline9RegularNodeSolver({
    ...params,
    nodeWithPortPoints: node,
  })
  const networkedSolver = new Pipeline9NetworkedHighDensitySolver({
    ...params,
    nodePortPoints: [node],
    fixedHdRoutes: [],
    enableRegionalFallback: false,
    autorouterVersion: AUTOROUTER_VERSION,
  })
  const input = networkedSolver["createNodeInput"](node)
  expect(input.obstacles).toEqual([])
  expect(input.connectivityNetMap["foreign-canonical-net"]).toBeUndefined()
  expect(input.fixedPadClearance?.rectangles).toHaveLength(1)
  expect(input.fixedPadClearance?.rectangles[0]?.ownerNetIds).toEqual([
    "foreign-canonical-net",
  ])
  const wireInput = JSON.parse(
    JSON.stringify(input),
  ) as Pipeline9NetworkedHighDensityNodeInput
  fullSolver.solve()
  const remoteResult = solvePipeline9NetworkedHighDensityNode(wireInput)
  expect(fullSolver.failed).toBeFalse()
  expect(fullSolver.solved).toBeTrue()
  expect(remoteResult).toEqual({
    status: "solved",
    solutionStage: "ordinary",
    routes: fullSolver.routes,
  })
  expect(fullSolver.routes).toHaveLength(1)
  const route = fullSolver.routes[0]!
  expect(route.route.length).toBeGreaterThan(2)
  for (let position = 1; position < route.route.length; position++) {
    expect(
      fixedPadClearance.traceClearanceIndex.isSegmentClear({
        start: route.route[position - 1]!,
        end: route.route[position]!,
        canonicalNetId: "route-net",
        copperDiameter: route.traceThickness,
      }),
    ).toBeTrue()
  }
  expect(networkedSolver.stats.remoteRequestsStarted).toBe(0)
})
