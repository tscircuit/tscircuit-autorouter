import { expect, test } from "bun:test"
import { checkCopperToBoardEdgeClearance } from "@tscircuit/checks"
import { getPipeline9PhysicalOwnership } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import { getPipeline9ViaPlacementValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ViaPlacementValidator"
import { SingleTransitionIntraNodeSolver } from "lib/solvers/HighDensitySolver/SingleTransitionIntraNodeSolver"
import { createPcbBoardElement } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types/srj-types"

test("legal anchors clear the whole via pad at an original concave board edge", (): void => {
  const srj: SimpleRouteJson = { layerCount: 4, minTraceWidth: 0.15,
    bounds: { minX: 0, maxX: 4, minY: 0, maxY: 4 },
    minBoardEdgeClearance: 0.1,
    outline: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 1 },
      { x: 1, y: 1 }, { x: 1, y: 4 }, { x: 0, y: 4 }],
    obstacles: [], connections: [{ name: "signal", pointsToConnect: [] }] }
  const validate = getPipeline9ViaPlacementValidator({ boardGeometry: srj, boardObstacles: [],
    physicalOwnership: getPipeline9PhysicalOwnership({ originalSrj: srj }), layerCount: 4, clearance: 0.1 })
  expect(validate({ x: 0.7625, y: 2, zStart: 1, zEnd: 3, viaDiameter: 0.3 }, "signal")).toBe(false)
  const solver = new SingleTransitionIntraNodeSolver({
    nodeWithPortPoints: { capacityMeshNodeId: "concave-anchor", center: { x: 0.9, y: 2 }, width: 0.4, height: 0.4,
      availableZ: [1, 3], portPoints: [
        { x: 0.7, y: 2, z: 1, connectionName: "signal" },
        { x: 0.825, y: 2, z: 3, connectionName: "signal" }] },
    viaDiameter: 0.3, viaPlacementValidator: validate,
  })
  expect(solver.solved).toBe(true)
  const via = solver.solvedRoutes[0]!.vias[0]!
  expect(via).toEqual({ x: 0.7, y: 2 })
  expect(validate({ ...via, zStart: 1, zEnd: 3, viaDiameter: 0.3 }, "signal")).toBe(true)
  const errors = checkCopperToBoardEdgeClearance([createPcbBoardElement(srj),
    { type: "pcb_via", pcb_via_id: "anchor-via", ...via, outer_diameter: 0.3, hole_diameter: 0.15,
      layers: ["top", "inner1", "inner2", "bottom"] }])
  expect(errors).toEqual([])
})
