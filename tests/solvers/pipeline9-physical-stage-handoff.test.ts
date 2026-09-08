import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types/srj-types"

test("Pipeline9 carries original fixed-pad geometry through pathing distribution and ordinary detailed routing", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    minTraceToPadEdgeClearance: 0.1,
    minViaEdgeToPadEdgeClearance: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 2 },
    obstacles: [{
      type: "rect",
      obstacleId: "foreign-pad",
      center: { x: 0, y: 0 },
      width: 0.8,
      height: 0.8,
      ccwRotationDegrees: 45,
      layers: ["top"],
      connectedTo: [],
    }],
    connections: [{
      name: "signal",
      pointsToConnect: [
        { x: -2, y: 0, layer: "top" },
        { x: 2, y: 0, layer: "top" },
      ],
    }],
  }
  const original = structuredClone(srj)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj)
  solver.solveUntilPhase("highDensityForceImproveSolver")
  expect(solver.error).toBeNull()
  expect(solver.failed).toBe(false)
  expect(solver.portPointPathingSolver?.solved).toBe(true)
  expect(solver.uniformPortDistributionSolver?.solved).toBe(true)
  expect(solver.highDensityRouteSolver?.solved).toBe(true)
  const highDensity = solver.highDensityRouteSolver!
  const clearance = highDensity.fixedPadClearance!
  expect(clearance.rectangles).toHaveLength(1)
  expect(clearance.rectangles[0].ccwRotationDegrees).toBe(45)
  expect(clearance.traceToPadClearance).toBe(0.1)
  expect(highDensity.routes.length).toBeGreaterThan(0)
  const netId = solver.connMap.getNetConnectedToId("signal")
  expect(netId).toBeDefined()
  for (const route of highDensity.routes) {
    for (let position = 1; position < route.route.length; position++) {
      const start = route.route[position - 1]
      const end = route.route[position]
      if (start.z === end.z) {
        expect(clearance.traceClearanceIndex.isSegmentClear({
          start,
          end,
          canonicalNetId: netId!,
          copperDiameter: route.traceThickness,
        })).toBe(true)
      } else {
        for (let z = Math.min(start.z, end.z); z <= Math.max(start.z, end.z); z++) {
          expect(clearance.viaClearanceIndex.isPointClear({
            point: { ...end, z },
            canonicalNetId: netId!,
            copperDiameter: route.viaDiameter,
          })).toBe(true)
        }
      }
    }
  }
  expect(srj).toEqual(original)
})
