import { expect, test } from "bun:test"
import { canonicalizePipeline9HdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canonicalizePipeline9HdRoutes"
import { createElectricalTreeRepairWalks } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createElectricalTreeRepairWalks"
import { SharedElectricalTreeClearanceSolver } from "lib/solvers/SharedElectricalTreeClearanceSolver/SharedElectricalTreeClearanceSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"

test("producer identities preserve through-obstacle and jumper inactivity, every protected copy and original segment metadata", (): void => {
  const connection: SimpleRouteConnection = { name: "protected", rootConnectionName: "bus", pointsToConnect: [{ x: -1, y: 0, layer: "top", pcb_port_id: "A" }, { x: 1, y: 0, layer: "bottom", pcb_port_id: "C" }],
    electricalBranch: { netId: "bus", startVertexId: "A", endVertexId: "C", logicalConnectionNames: ["protected"] } }
  const original: HighDensityRoute = { connectionName: "protected", rootConnectionName: "bus", traceThickness: 0.1, viaDiameter: 0.2, vias: [], route: [
    { x: -1, y: 0, z: 0, pcb_port_id: "A" },
    { x: 0, y: 0, z: 0, toNextSegmentType: "through_obstacle", toNextSegmentCircuitJsonMetadata: { pcb_plated_hole_id: "owned-hole" } },
    { x: 0.2, y: 0.1, z: 1 }, { x: 0.5, y: 0.1, z: 1, insideJumperPad: true },
    { x: 1, y: 0, z: 1, pcb_port_id: "C" },
  ] }
  const routes = canonicalizePipeline9HdRoutes([original])
  const adapter = createElectricalTreeRepairWalks({ connections: [connection], routes, layerCount: 2 })
  const inputBefore = structuredClone(adapter.routes)
  const srj: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1, bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, connections: [connection], obstacles: [
    { type: "rect", center: { x: 0.1, y: 0.05 }, width: 0.5, height: 0.4, layers: ["top", "bottom"], connectedTo: ["bus"], circuitJsonMetadata: { pcb_plated_hole_id: "owned-hole" } },
    { type: "rect", center: { x: 0, y: -0.1 }, width: 0.2, height: 0.1, layers: ["top"], connectedTo: ["foreign"] },
  ] }
  const solver = new SharedElectricalTreeClearanceSolver({ srj: { ...srj, traces: undefined }, routes: adapter.routes, bounds: srj.bounds, boundaryMargin: 0,
    lockedPointIndices: adapter.lockedPointIndices, segmentIdentityByRoute: adapter.segmentIdentityByRoute, allowViaMovement: true })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.stats.treePrimitiveOriginalAdjacencyReferences).toBe(9)
  expect(solver.stats.treePrimitiveInactiveAdjacencyReferences).toBe(6)
  expect(solver.stats.treePrimitiveActiveViaCount).toBe(0)
  expect(solver.stats.treePrimitiveLockedCoordinateVariables).toBe(5)
  expect(adapter.decode(solver.getOutput())).toEqual(routes)
  expect(routes).toEqual([original])
  expect(adapter.routes).toEqual(inputBefore)
  expect(solver.getOutput()[0]!.route.filter((point) => point.toNextSegmentType === "through_obstacle")).toHaveLength(2)
  expect(solver.getOutput()[0]!.route.filter((point) => point.insideJumperPad)).toHaveLength(2)
})
