import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9RegularNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("each grown portfolio candidate is checked in original coordinates with original copper diameters", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "translated-full-stack",
    center: { x: 10, y: 10 },
    width: 0.4,
    height: 1,
    availableZ: [0, 1, 2, 3, 4, 5, 6, 7],
    portPoints: [
      { x: 10.2, y: 9.5, z: 0, connectionName: "signal" },
      { x: 10.2, y: 10.5, z: 7, connectionName: "signal" },
    ],
  }
  const original = structuredClone(node)
  let calls = 0
  let rejected = 0
  let accepted = 0
  const solver = createPipeline9RegularNodeSolver({
    nodeWithPortPoints: node,
    connMap: new ConnectivityMap({ net: ["signal"] }),
    colorMap: {},
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
    nodePfById: {},
    obstacles: [],
    layerCount: 8,
    physicalRouteValidator: (routes) => {
      calls++
      expect(routes).toHaveLength(1)
      const route = routes[0]!
      expect(route.route[0]!.x).toBeCloseTo(10.2, 12)
      expect(route.route[0]!.y).toBeCloseTo(9.5, 12)
      expect(route.route.at(-1)!.x).toBeCloseTo(10.2, 12)
      expect(route.route.at(-1)!.y).toBeCloseTo(10.5, 12)
      expect(route.viaDiameter).toBe(0.3)
      const valid = route.vias.every(
        (via) => 10.3 - via.x - route.viaDiameter / 2 >= 0.1 - 1e-9,
      )
      if (valid) accepted++
      else rejected++
      return valid
    },
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.stats.highDensityResizeCount).toBe(1)
  expect(rejected).toBeGreaterThan(0)
  // The accepted inner candidate is checked again by the final outer guard.
  expect(accepted).toBe(2)
  expect(calls).toBeGreaterThan(accepted)
  expect(node).toEqual(original)
})
