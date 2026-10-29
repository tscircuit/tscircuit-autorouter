import { expect, test } from "bun:test"
import { getPipeline9PhysicalOwnership } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import { getPipeline9ViaPlacementValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ViaPlacementValidator"
import { SingleTransitionIntraNodeSolver } from "lib/solvers/HighDensitySolver/SingleTransitionIntraNodeSolver"
import type { ViaPlacement } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"
import { makeSingleTransitionAnchorNode } from "./fixtures/single-transition-legal-anchors"

test("anchors retain the actual route owner, world coordinates, diameter, and manufactured span", (): void => {
  const srj: SimpleRouteJson = { layerCount: 4, minTraceWidth: 0.15,
    bounds: { minX: 8, maxX: 12, minY: -22, maxY: -18 },
    connections: [
      { name: "signal", pointsToConnect: [{ x: 9, y: -20, layer: "inner1", pcb_port_id: "signal-pad" }] },
      { name: "foreign-pad-owner", pointsToConnect: [{ x: 10, y: -20, layer: "top", pcb_port_id: "foreign-pad" }] },
    ], obstacles: [
      { type: "rect", center: { x: 10, y: -20 }, width: 0.4, height: 0.4, layers: ["top"], connectedTo: ["foreign-pad"] },
      { type: "rect", center: { x: 9, y: -20 }, width: 0.3, height: 0.3, layers: ["top"], connectedTo: ["signal-pad"] },
    ] }
  const validate = getPipeline9ViaPlacementValidator({ boardGeometry: srj, boardObstacles: srj.obstacles,
    physicalOwnership: getPipeline9PhysicalOwnership({ originalSrj: srj,
      derivedConnections: [{ name: "signal-branch", __netConnectionName: "signal", pointsToConnect: [] }] }),
    layerCount: 4, clearance: 0.1 })
  const node = makeSingleTransitionAnchorNode()
  node.width = 2
  node.height = 2
  node.portPoints[0] = { ...node.portPoints[0]!, x: 9, z: 1, rootConnectionName: "foreign-pad-owner" }
  node.portPoints[1] = { ...node.portPoints[1]!, x: 11, z: 3, rootConnectionName: "foreign-pad-owner" }
  const observed: Array<{ placement: ViaPlacement; connectionName: string }> = []
  const solver = new SingleTransitionIntraNodeSolver({ nodeWithPortPoints: node, viaDiameter: 0.3,
    viaPlacementValidator: (placement, connectionName): boolean => {
      observed.push({ placement: { ...placement }, connectionName })
      return validate(placement, connectionName)
    } })
  expect(solver.solved).toBe(true)
  expect(solver.solvedRoutes[0]!.vias).toEqual([{ x: 9, y: -20 }])
  expect(observed.every(({ placement, connectionName }) => connectionName === "signal-branch" &&
    placement.viaDiameter === 0.3 && placement.zStart === 1 && placement.zEnd === 3 &&
    placement.x >= 9 && placement.x <= 11 && placement.y >= -21 && placement.y <= -19)).toBe(true)
  expect(validate(observed[0]!.placement, "signal-branch")).toBe(false)
  expect(validate(observed[0]!.placement, "foreign-pad-owner")).toBe(true)
  expect(validate({ x: 9, y: -20, zStart: 1, zEnd: 3, viaDiameter: 0.3 }, "unknown-owner")).toBe(false)
})
