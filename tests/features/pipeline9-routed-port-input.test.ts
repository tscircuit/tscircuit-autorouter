import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import scenario from "../../fixtures/legacy/assets/e2e3.json"

test("redistribution sees exactly the routed ports of the full pathing graph", (): void => {
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario) as SimpleRouteJson,
    { cacheProvider: null },
  )
  pipeline.solveUntilPhase("uniformPortDistributionSolver")
  const pathing = pipeline.portPointPathingSolver!
  const routed = pathing.getOutput({ includeInputNodes: false })
  expect(routed).not.toHaveProperty("inputNodeWithPortPoints")
  const compact = pathing.getInputNodesForRoutedPorts(
    routed.nodesWithPortPoints,
  )
  const full = pathing.getOutput()
  const routedIds = new Set(
    routed.nodesWithPortPoints.flatMap((node) =>
      node.portPoints.map((port) => port.portPointId),
    ),
  )
  expect(routedIds.size).toBeGreaterThan(0)
  expect(full.nodesWithPortPoints).toEqual(routed.nodesWithPortPoints)
  expect(compact).toEqual(
    full.inputNodeWithPortPoints.map((node) => ({
      ...node,
      portPoints: node.portPoints.filter((port) =>
        routedIds.has(port.portPointId),
      ),
    })),
  )
  expect(
    full.inputNodeWithPortPoints.some(
      (node, i) => node.portPoints.length > compact[i]!.portPoints.length,
    ),
  ).toBe(true)
})
