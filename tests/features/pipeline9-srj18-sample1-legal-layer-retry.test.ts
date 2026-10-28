import { expect, test } from "bun:test"
import { Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { SimpleRouteJson } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import capturedNode from "../fixtures/srj18-sample1-impossible-node.json"

test("Pipeline9 retries an impossible SRJ18 node across legal layers", (): void => {
  // Capture the failing node so changed MST pairs cannot bypass this behavior.
  const fixture = capturedNode as unknown as {
    node: NodeWithPortPoints
    connections: SimpleRouteJson["connections"]
    bounds: SimpleRouteJson["bounds"]
    options: Omit<Pipeline9HighDensitySolverParams, "nodePortPoints" | "connMap">
  }
  const solver = new Pipeline9HighDensitySolver({
    ...fixture.options,
    nodePortPoints: [structuredClone(fixture.node)],
    connMap: getConnectivityMapFromSimpleRouteJson({
      layerCount: fixture.options.layerCount,
      minTraceWidth: fixture.options.traceWidth,
      obstacles: fixture.options.obstacles,
      connections: fixture.connections,
      bounds: fixture.bounds,
    }),
  })

  while (!solver.activeFallbackSolver && !solver.solved && !solver.failed) {
    solver.step()
  }
  expect(fixture.node.availableZ).toEqual([0])
  expect(solver.activeFallbackSolver?.params.nodeWithPortPoints.availableZ)
    .toEqual([0, 1])
  solver.solve()

  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(solver.stats.fallbackNodeCount).toBe(1)
  expect(
    solver.routes.every((route) =>
      route.route.every((point) => point.z === 0 || point.z === 1),
    ),
  ).toBeTrue()
})
