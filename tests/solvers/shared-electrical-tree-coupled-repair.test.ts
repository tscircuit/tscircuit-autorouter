import { expect, test } from "bun:test"
import { RelaxTraceClearanceSolver } from "@tscircuit/repair04"
import { createElectricalTreeRepairWalks } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createElectricalTreeRepairWalks"
import { assertSharedElectricalTreeRoutes } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/assertSharedElectricalTreeRoutes"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("a shared free junction moves atomically while pad locks and physical via multiplicity survive repair walks", (): void => {
  const terminals = [{ x: -1, y: 0, z: 0, pcb_port_id: "A" }, { x: 1, y: 0, z: 0, pcb_port_id: "B" }, { x: 0, y: 1, z: 1, pcb_port_id: "C" }]
  const connections: SimpleRouteConnection[] = terminals.map((pad, index) => ({
    name: `branch${index}`, rootConnectionName: "bus",
    pointsToConnect: [{ x: pad.x, y: pad.y, layer: pad.z === 0 ? "top" : "bottom", pcb_port_id: pad.pcb_port_id }, { x: 0, y: 0, layer: "top", pointId: "J" }],
    electricalBranch: { netId: "bus", startVertexId: pad.pcb_port_id, endVertexId: "J", logicalConnectionNames: ["bus"] },
  }))
  const routes: HighDensityRoute[] = terminals.map((pad, index) => ({ connectionName: `branch${index}`, rootConnectionName: "bus", traceThickness: 0.1, viaDiameter: 0.2,
    startPcbPortId: pad.pcb_port_id,
    route: index === 2 ? [pad, { x: 0, y: 0.5, z: 1 }, { x: 0, y: 0.5, z: 0 }, { x: 0, y: 0, z: 0 }] : [pad, { x: 0, y: 0, z: 0 }],
    vias: index === 2 ? [{ x: 0, y: 0.5 }] : [],
  }))
  const srj: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1, bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, connections,
    obstacles: [{ type: "rect", center: { x: 0, y: -0.15 }, width: 0.2, height: 0.2, layers: ["top"], connectedTo: ["foreign"] }] }
  const adapter = createElectricalTreeRepairWalks({ connections, routes })
  expect(adapter.junctionCount).toBe(1)
  expect(adapter.routes).toHaveLength(1)
  const mixed = structuredClone(routes)
  mixed[1]!.traceThickness = 0.2
  mixed[1]!.viaDiameter = 0.4
  const mixedWalks = createElectricalTreeRepairWalks({ connections, routes: mixed })
  expect(mixedWalks.routes[0]!.viaDiameter).toBe(0.4)
  expect(mixedWalks.routes[0]!.route.filter((point) => point.pcb_port_id === "B").every((point) => point.traceThickness === 0.2)).toBe(true)
  const solver = new RelaxTraceClearanceSolver({ srj: { ...srj, traces: undefined }, routes: adapter.routes, bounds: srj.bounds, boundaryMargin: 0,
    lockedPointIndices: adapter.routes.map((route) => route.route.map(() => false)), traceClearance: 0.1, viaClearance: 0.1, allowViaMovement: true })
  solver.solve()
  expect(solver.solved).toBe(true)
  const output = adapter.decode(solver.getOutput())
  assertSharedElectricalTreeRoutes({ connections, routes: output, layerCount: 2 })
  const joint = output[0]!.route.at(-1)!
  expect(joint.y).toBeGreaterThan(0.05)
  expect(output.map((route) => route.route.at(-1))).toEqual([joint, joint, joint])
  expect(output.map((route) => route.route[0])).toEqual(terminals)
  expect(output.reduce((count, route) => count + route.vias.length, 0)).toBe(1)
  const inconsistent = structuredClone(solver.getOutput())
  inconsistent[0]!.route[1]!.x += 0.01
  expect(() => adapter.decode(inconsistent)).toThrow("shared occurrences inconsistently")
})
