import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9FixedPadClearance } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9FixedPadClearance"
import { createPipeline9RegularNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("Pipeline9 ordinary routing preserves a physical detour between clear pad-corner terminals", (): void => {
  const connMap = new ConnectivityMap({
    "route-net": ["route"],
    "pad-net": ["pad"],
  })
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "corner-node",
    center: { x: 1.2, y: -1.2 },
    width: 0.44,
    height: 0.44,
    availableZ: [0],
    portPoints: [
      { x: 1.42, y: -1.2, z: 0, connectionName: "route" },
      { x: 1.2, y: -1.42, z: 0, connectionName: "route" },
    ],
  }
  const fixedPadClearance = createPipeline9FixedPadClearance({
    connMap,
    obstacles: [{
      type: "rect",
      center: { x: 1.6, y: -1.6 },
      width: 0.36,
      height: 0.36,
      layers: ["top"],
      connectedTo: ["pad"],
    }],
    layerCount: 2,
    traceToPadClearance: 0.1,
    viaToPadClearance: 0.1,
  })
  const index = fixedPadClearance.traceClearanceIndex
  expect(index.isSegmentClear({
    start: node.portPoints[0],
    end: node.portPoints[1],
    canonicalNetId: "route-net",
    copperDiameter: 0.15,
  })).toBe(false)
  const solver = createPipeline9RegularNodeSolver({
    nodeWithPortPoints: node,
    connMap,
    colorMap: {},
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.15,
    effort: 1,
    nodePfById: {},
    obstacles: [],
    layerCount: 2,
    fixedPadClearance,
  })
  expect(solver.physicalClearanceContext).toBeDefined()
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  expect(solver.routes).toHaveLength(1)
  const route = solver.routes[0]
  expect(route.traceThickness).toBe(0.15)
  expect(route.route.length).toBeGreaterThan(2)
  for (let position = 1; position < route.route.length; position++) {
    expect(index.isSegmentClear({
      start: route.route[position - 1],
      end: route.route[position],
      canonicalNetId: "route-net",
      copperDiameter: route.traceThickness,
    })).toBe(true)
  }
})
