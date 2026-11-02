import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { SimpleRouteConnection } from "lib/types"

test("accepts intermediate terminals on aliased nets", (): void => {
  for (const alias of ["additional-root", "net-name", "transitive"]) {
    const connections: SimpleRouteConnection[] = [
      {
        name: "a-to-c",
        __rootConnectionNames:
          alias === "net-name" ? ["root-a"] : ["root-a", "shared-alias"],
        __netConnectionName: alias === "net-name" ? "power" : undefined,
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "a" },
          { x: 2, y: 0, layer: "top", pcb_port_id: "c" },
        ],
      },
      {
        name: "b-to-d",
        __rootConnectionNames:
          alias === "additional-root"
            ? ["root-b", "shared-alias"]
            : ["root-b"],
        __netConnectionName: alias === "additional-root" ? undefined : "power",
        pointsToConnect: [
          { x: 1, y: 0, layer: "top", pcb_port_id: "b" },
          { x: 3, y: 0, layer: "top", pcb_port_id: "d" },
        ],
      },
    ]
    if (alias === "transitive") {
      connections.push({
        name: "alias-bridge",
        __rootConnectionNames: ["shared-alias"],
        __netConnectionName: "power",
        pointsToConnect: [
          { x: 4, y: 0, layer: "top", pcb_port_id: "e" },
          { x: 5, y: 0, layer: "top", pcb_port_id: "f" },
        ],
      })
    }
    // The source connections have no coincident coordinates or shared ports.
    // Only their aliases establish that the intermediate terminal belongs here.
    const params = {
      layerCount: 1,
      preserveTerminalPcbPortIds: true,
      connections,
      hdRoutes: [0, 1].map((x) => ({
        connectionName: "a-to-c",
        rootConnectionName: "root-a",
        startPcbPortId: x === 0 ? "a" : "b",
        endPcbPortId: x === 0 ? "b" : "c",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x, y: 0, z: 0 },
          { x: x + 1, y: 0, z: 0 },
        ],
        vias: [],
      })),
    }
    const solver = new MultipleHighDensityRouteStitchSolver3(params)
    solver.solve()
    expect(solver.failed, alias).toBeFalse()
    expect(solver.solved, alias).toBeTrue()
    expect(solver.mergedHdRoutes).toHaveLength(1)
    const route = solver.mergedHdRoutes[0]!
    expect(route.connectionName).toBe("a-to-c")
    expect(route.startPcbPortId).toBe("a")
    expect(route.endPcbPortId).toBe("c")
    expect(route.route[0]).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(route.route.at(-1)).toMatchObject({ x: 2, y: 0, z: 0 })

    connections[1]!.__rootConnectionNames = ["foreign-root"]
    connections[1]!.__netConnectionName = "foreign-net"
    expect(() =>
      new MultipleHighDensityRouteStitchSolver3(params).solve(),
    ).toThrow('unknown PCB terminal "b"')
  }
})
