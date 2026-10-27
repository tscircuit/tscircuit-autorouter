import { expect, test } from "bun:test"
import { BusLayerRoutingSolver } from "lib/solvers/BusLayerRoutingSolver"
import { createBusLayerInput } from "../fixtures/bus-layer-input"
import { createBusLayerHdRoute } from "../fixtures/createBusLayerHdRoute"

test("bus layer routing intersects overlapping bus rules across point-pair aliases", (): void => {
  const srj = createBusLayerInput()
  srj.connections[0]!.name = "DDR_D0_mst0"
  srj.connections[0]!.__rootConnectionNames = ["DDR_D0"]
  srj.buses![0]!.allowedLayers = ["top", "inner2", "bottom"]
  srj.buses!.push({ busId: "other-byte-rule", connectionNames: ["DDR_D0_mst0"], allowedLayers: ["top", "inner1", "bottom"] })
  srj.obstacles = [{ type: "rect", center: { x: 0, y: 0 }, width: 0.4, height: 40, layers: ["top"], connectedTo: [] }]
  const route = createBusLayerHdRoute()
  route.connectionName = "DDR_D0_mst0"
  const solver = new BusLayerRoutingSolver({ srj, hdRoutes: [route] })
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.stats.accepted).toBe(true)
  const output = solver.getOutput()[0]!
  expect(new Set(output.route.map((point) => point.z))).toEqual(new Set([0, 3]))
  expect(output.route[0]).toEqual(route.route[0])
  expect(output.route.at(-1)).toEqual(route.route.at(-1))
})
