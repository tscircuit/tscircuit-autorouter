import { expect, test } from "bun:test"
import { getRouteTerminalPcbPortId } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

test("PMP22650 MST70 does not inherit sibling MST53 terminal metadata", () => {
  const problem = {
    routeStartPort: new Int32Array([10]),
    routeEndPort: new Int32Array([20]),
  }

  expect(
    getRouteTerminalPcbPortId({
      problem,
      routeId: 0,
      portId: 15,
      pcbPortId: "pcb_port_altium_8256",
    }),
  ).toBeUndefined()
  expect(
    getRouteTerminalPcbPortId({
      problem,
      routeId: 0,
      portId: 10,
      pcbPortId: "pcb_port_altium_8258",
    }),
  ).toBe("pcb_port_altium_8258")
  expect(
    getRouteTerminalPcbPortId({
      problem,
      routeId: 0,
      portId: 20,
      pcbPortId: "pcb_port_altium_8253",
    }),
  ).toBe("pcb_port_altium_8253")
})
