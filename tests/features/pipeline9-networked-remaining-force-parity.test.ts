import { expect, test } from "bun:test"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { forceImprovePipeline9HighDensityNodeRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/forceImprovePipeline9HighDensityNodeRoutes"
import { Pipeline9RemainingForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/Pipeline9RemainingForceImproveSolver"
import { materializePipeline9HdRouteVias } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/materializePipeline9HdRouteVias"
import { simplifyPipeline9CollinearRoutePoints } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/simplifyPipeline9CollinearRoutePoints"
import { createPipeline9NetworkedForceFixture } from "../fixtures/pipeline9-networked-force-fixtures"

test("remaining force improvement keeps remote routes and preserves interleaved route order", (): void => {
  const { nodes, routes } = createPipeline9NetworkedForceFixture()
  const originalNodeRoutes = routes.map((route) => ({
    ...route,
    rootConnectionName: `original_${route.connectionName}`,
  }))
  const params = {
    nodeWithPortPoints: nodes,
    hdRoutes: originalNodeRoutes,
    colorMap: {},
    totalStepsPerNode: 20,
    nodeAssignmentMargin: 0.15,
  }
  const globalForce = new HighDensityForceImproveSolver({
    ...params,
    hdRoutes: simplifyPipeline9CollinearRoutePoints(
      materializePipeline9HdRouteVias(originalNodeRoutes),
    ),
  })
  globalForce.solve()
  const improvedNodeA = forceImprovePipeline9HighDensityNodeRoutes({
    nodeWithPortPoints: nodes[0]!,
    hdRoutes: routes.filter((route) => route.regionId === "node_a"),
    colorMap: {},
    totalStepsPerNode: 20,
    nodeAssignmentMargin: 0.15,
    preserveTerminalPcbPortIds: false,
  })
  const mixedRoutes = [
    improvedNodeA[0]!,
    originalNodeRoutes[1]!,
    improvedNodeA[1]!,
  ]
  const remainingForce = new Pipeline9RemainingForceImproveSolver({
    ...params,
    hdRoutes: mixedRoutes,
    forceImprovedRegionIds: new Set(["node_a"]),
  })
  remainingForce.solve()
  const output = remainingForce.getOutput()
  expect(remainingForce.solved).toBeTrue()
  expect(remainingForce.stats.sampleCount).toBe(1)
  expect(output).toEqual(globalForce.getOutput())
  expect(output[0]).toBe(mixedRoutes[0])
  expect(output[2]).toBe(mixedRoutes[2])
  expect(output.map((route) => route.connectionName)).toEqual([
    "signal_a",
    "signal_b",
    "neighbor_a",
  ])
  const allRemote = new Pipeline9RemainingForceImproveSolver({
    ...params,
    hdRoutes: output,
    forceImprovedRegionIds: new Set(["node_a", "node_b"]),
  })
  allRemote.solve()
  expect(allRemote.stats.sampleCount).toBe(0)
  expect(allRemote.stats.preImprovedRouteCount).toBe(3)
  expect(allRemote.getOutput()).toEqual(output)
  expect(
    () =>
      new Pipeline9RemainingForceImproveSolver({
        ...params,
        hdRoutes: [
          improvedNodeA[0]!,
          { ...originalNodeRoutes[2]!, regionId: undefined },
        ],
        forceImprovedRegionIds: new Set(["node_a"]),
      }),
  ).toThrow('assigned to already improved node "node_a"')
})
