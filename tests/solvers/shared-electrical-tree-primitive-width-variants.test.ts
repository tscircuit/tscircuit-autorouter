import { expect, test } from "bun:test"
import { createElectricalTreeRepairWalks } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createElectricalTreeRepairWalks"
import { SharedElectricalTreeClearanceSolver } from "lib/solvers/SharedElectricalTreeClearanceSolver/SharedElectricalTreeClearanceSolver"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("real outgoing-width reversal retains each conservative source-adjacency radius variant", (): void => {
  const connection: SimpleRouteConnection = { name: "widths", rootConnectionName: "bus", pointsToConnect: [{ x: -1, y: 0, layer: "top", pcb_port_id: "A" }, { x: 1, y: 0, layer: "top", pcb_port_id: "C" }],
    electricalBranch: { netId: "bus", startVertexId: "A", endVertexId: "C", logicalConnectionNames: ["widths"] } }
  const route: HighDensityRoute = { connectionName: "widths", rootConnectionName: "bus", traceThickness: 0.1, viaDiameter: 0.2, vias: [], route: [
    { x: -1, y: 0, z: 0, pcb_port_id: "A", traceThickness: 0.6 }, { x: 0, y: 0, z: 0, traceThickness: 0.2 }, { x: 1, y: 0, z: 0, pcb_port_id: "C", traceThickness: 0.2 },
  ] }
  const adapter = createElectricalTreeRepairWalks({ connections: [connection], routes: [route], layerCount: 2 })
  const radii: number[] = []
  for (let index = 0; index < adapter.segmentIdentityByRoute[0]!.length; index++) {
    const identity = adapter.segmentIdentityByRoute[0]![index]!
    if (identity.kind !== "physical" || identity.sourceSegmentIndex !== 1) continue
    const a = adapter.routes[0]!.route[index]!, b = adapter.routes[0]!.route[index + 1]!
    radii.push(Math.max(a.traceThickness!, b.traceThickness!) / 2)
  }
  expect(radii).toEqual([0.1, 0.3])
  const srj: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1, bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, connections: [connection], obstacles: [] }
  const solver = new SharedElectricalTreeClearanceSolver({ srj: { ...srj, traces: undefined }, routes: adapter.routes, bounds: srj.bounds, boundaryMargin: 0,
    lockedPointIndices: adapter.lockedPointIndices, segmentIdentityByRoute: adapter.segmentIdentityByRoute })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.stats.treePrimitiveDistinctSourceAdjacencies).toBe(2)
  expect(solver.stats.treePrimitivePhysicalVariants).toBe(3)
  expect(solver.stats.treePrimitiveMultipleVariantSources).toBe(1)
  expect(solver.stats.treePrimitiveMergedSourceReferences).toBe(1)
  expect(adapter.decode(solver.getOutput())).toEqual([route])
})
