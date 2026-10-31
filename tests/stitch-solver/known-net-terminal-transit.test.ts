import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { SimpleRouteConnection } from "lib/types"

test("allows an intermediate terminal only when the source connections place it on the same net", () => {
  for (const intermediateRoot of ["power", "foreign"]) {
    const connections: SimpleRouteConnection[] = [{
      name: "a-to-c",
      __rootConnectionNames: ["power"],
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pcb_port_id: "a" },
        { x: 2, y: 0, layer: "top", pcb_port_id: "c" },
      ],
    }, {
      name: "b-to-c",
      __rootConnectionNames: [intermediateRoot],
      pointsToConnect: [
        { x: 1, y: 0, layer: "top", pcb_port_id: "b" },
        { x: 2, y: 0, layer: "top", pcb_port_id: "c" },
      ],
    }]
    const params = {
      layerCount: 1,
      preserveTerminalPcbPortIds: true,
      connections,
      hdRoutes: [0, 1].map((x) => ({
        connectionName: "a-to-c",
        rootConnectionName: "power",
        startPcbPortId: x === 0 ? "a" : "b",
        endPcbPortId: x === 0 ? "b" : "c",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [{ x, y: 0, z: 0 }, { x: x + 1, y: 0, z: 0 }],
        vias: [],
      })),
    }
    if (intermediateRoot === "foreign") {
      expect(() => new MultipleHighDensityRouteStitchSolver3(params).solve()).toThrow('unknown PCB terminal "b"')
      continue
    }
    const solver = new MultipleHighDensityRouteStitchSolver3(params)
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(new Set([solver.mergedHdRoutes[0].startPcbPortId, solver.mergedHdRoutes[0].endPcbPortId])).toEqual(new Set(["a", "c"]))
  }
})
