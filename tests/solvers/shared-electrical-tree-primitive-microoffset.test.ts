import { expect, test } from "bun:test"
import { canonicalizePipeline9HdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canonicalizePipeline9HdRoutes"
import { createElectricalTreeRepairWalks } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createElectricalTreeRepairWalks"
import { SharedElectricalTreeClearanceSolver } from "lib/solvers/SharedElectricalTreeClearanceSolver/SharedElectricalTreeClearanceSolver"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("the actual canonicalize-to-walk boundary preserves tolerated microoffset vias before exact primitive validation", (): void => {
  const connection: SimpleRouteConnection = { name: "column", rootConnectionName: "bus", pointsToConnect: [{ x: -1, y: 0, layer: "top", pcb_port_id: "A" }, { x: 1, y: 0, layer: "bottom", pcb_port_id: "C" }],
    electricalBranch: { netId: "bus", startVertexId: "A", endVertexId: "C", logicalConnectionNames: ["column"] } }
  const route: HighDensityRoute = { connectionName: "column", rootConnectionName: "bus", traceThickness: 0.1, viaDiameter: 0.2, vias: [{ x: 1e-10, y: 0 }], route: [
    { x: -1, y: 0, z: 0, pcb_port_id: "A" }, { x: 0, y: 0, z: 0 }, { x: 1e-10, y: 0, z: 1 }, { x: 1, y: 0, z: 1, pcb_port_id: "C" },
  ] }
  const routes = canonicalizePipeline9HdRoutes([route])
  expect(routes[0]!.route[0]).toEqual(route.route[0])
  expect(routes[0]!.route.at(-1)).toEqual(route.route.at(-1))
  const adapter = createElectricalTreeRepairWalks({ connections: [connection], routes, layerCount: 2 })
  const srj: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1, bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, connections: [connection], obstacles: [] }
  const solver = new SharedElectricalTreeClearanceSolver({ srj: { ...srj, traces: undefined }, routes: adapter.routes, bounds: srj.bounds, boundaryMargin: 0,
    lockedPointIndices: adapter.lockedPointIndices, segmentIdentityByRoute: adapter.segmentIdentityByRoute })
  solver.solve()
  const output = adapter.decode(solver.getOutput())
  expect(output).toEqual(routes)
  expect(solver.stats.treePrimitiveActiveViaCount).toBe(1)
  expect(solver.stats.treePrimitiveMergedSourceReferences).toBeGreaterThan(0)
  for (let index = 1; index < output[0]!.route.length; index++) {
    const a = output[0]!.route[index - 1]!, b = output[0]!.route[index]!
    if (a.z !== b.z) expect([a.x, a.y]).toEqual([b.x, b.y])
  }
})
