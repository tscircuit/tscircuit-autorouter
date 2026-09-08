import { expect, test } from "bun:test"
import { AUTOROUTER_VERSION } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/autorouterVersion"
import { Pipeline9NetworkedHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/Pipeline9NetworkedHighDensitySolver"
import type { Pipeline9NetworkedHighDensityNodeInput } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9NetworkedTypes"
import { solvePipeline9NetworkedHighDensityNode } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/solvePipeline9NetworkedHighDensityNode"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { createPipeline9RegionalPhysicalProblem } from "../fixtures/pipeline9RegionalPhysicalClearance"

test("JSON network regional physical routing matches the local existing terminal policy", (): void => {
  const fixture = createPipeline9RegionalPhysicalProblem()
  const secondPair: [PortPoint, PortPoint] = [
    {
      x: 3,
      y: -4,
      z: 0,
      connectionName: "second-target",
      rootConnectionName: "preload-root",
      portPointId: "second-start",
      nextPortPointId: "second-end",
    },
    {
      x: 3,
      y: 0,
      z: 0,
      connectionName: "second-target",
      rootConnectionName: "preload-root",
      portPointId: "second-end",
      prevPortPointId: "second-start",
    },
  ]
  const node: NodeWithPortPoints = {
    ...fixture.node,
    portPoints: [...fixture.node.portPoints, ...secondPair],
    portPointsInPairs: [fixture.pair, secondPair],
  }
  const originalNode = structuredClone(node)
  const originalObstacles = structuredClone(fixture.obstacles)
  const params: ConstructorParameters<typeof Pipeline9HighDensitySolver>[0] = {
    ...fixture.params,
    nodePortPoints: [node],
    fixedHdRoutes: [],
    enableRegionalFallback: true,
  }
  const local = new Pipeline9HighDensitySolver(params)
  const networked = new Pipeline9NetworkedHighDensitySolver({
    ...params,
    autorouterVersion: AUTOROUTER_VERSION,
  })
  const input = networked["createNodeInput"](node)
  expect(input.fixedPadClearance?.rectangles).toHaveLength(3)
  const wireInput = JSON.parse(
    JSON.stringify(input),
  ) as Pipeline9NetworkedHighDensityNodeInput
  // Alternating top-layer pairs are impossible in the original one-layer
  // node. Its already existing regional policy exposes both board layers.
  local.solve()
  const remote = solvePipeline9NetworkedHighDensityNode(wireInput)
  expect(local.failed).toBe(false)
  expect(local.solved).toBe(true)
  expect(local.stats.fallbackNodeCount).toBe(1)
  expect(remote.status).toBe("solved")
  expect(remote.solutionStage).toBe("regional-fallback")
  if (remote.status !== "solved") {
    throw new Error(`Expected the generic regional solve: ${remote.error}`)
  }
  expect(remote.routes).toEqual(local.routes)
  expect(remote.routes).toHaveLength(2)
  expect(
    remote.routes.map((route): string => route.connectionName).sort(),
  ).toEqual(["local-target", "second-target"])
  for (const route of remote.routes) {
    const pair =
      route.connectionName === "local-target" ? fixture.pair : secondPair
    expect(route.traceThickness).toBe(0.125)
    expect(route.viaDiameter).toBe(0.25)
    expect([route.route[0], route.route.at(-1)]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ x: pair[0].x, y: pair[0].y, z: pair[0].z }),
        expect.objectContaining({ x: pair[1].x, y: pair[1].y, z: pair[1].z }),
      ]),
    )
  }
  expect(node).toEqual(originalNode)
  expect(fixture.obstacles).toEqual(originalObstacles)
  expect(networked.stats.remoteRequestsStarted).toBe(0)
})
