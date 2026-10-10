import { expect, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { Obstacle } from "lib/types"

test("terminal tapers reject distant pads before resolving connectivity", (): void => {
  const terminalConnections = ["branch", "root", "branch_alias", "root_alias"]
  for (const connectedId of terminalConnections) {
    const connMap = new ConnectivityMap({
      branch_net: ["branch", "branch_alias"],
      root_net: ["root", "root_alias"],
      unrelated_net: ["unrelated"],
    })
    const connectedQuery = spyOn(connMap, "areIdsConnected")
    const obstacles: Obstacle[] = [
      ...Array.from({ length: 30 }, (_, index): Obstacle => ({
        type: "rect",
        center: { x: index + 10, y: 5 },
        width: 0.4,
        height: 0.2,
        layers: ["top"],
        connectedTo: Array.from(
          { length: 40 },
          (_, aliasIndex) => `distant_${index}_${aliasIndex}`,
        ),
      })),
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.2,
        layers: ["top"],
        connectedTo: [connectedId],
      },
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.8,
        height: 0.2,
        layers: ["top"],
        connectedTo: [connectedId],
      },
      {
        type: "rect",
        center: { x: 4, y: 0 },
        width: 0.4,
        height: 0.3,
        layers: ["top"],
        connectedTo: [connectedId],
      },
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.01,
        layers: ["top"],
        connectedTo: ["unrelated"],
      },
      {
        type: "rect",
        center: { x: 4, y: 0 },
        width: 0.4,
        height: 0.01,
        layers: ["bottom"],
        connectedTo: [connectedId],
      },
    ]
    const solver = new TraceWidthSolver({
      hdRoutes: [
        {
          connectionName: "branch",
          rootConnectionName: "root",
          traceThickness: 1,
          viaDiameter: 0.3,
          vias: [],
          route: [
            { x: 0, y: 0, z: 0 },
            { x: 4, y: 0, z: 0 },
          ],
        },
      ],
      connection: [],
      obstacles,
      connMap,
      minTraceWidth: 0.1,
      layerCount: 2,
    })
    solver.solve()
    const [route] = solver.getHdRoutesWithWidths()
    expect(route!.route.map((point) => point.x)).toEqual([
      0, 0.25, 0.4, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2,
      2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75, 3.8, 4,
    ])
    expect(
      route!.route
        .filter((point) => point.x <= 0.4)
        .every((point) => point.traceThickness === 0.2),
    ).toBe(true)
    expect(route!.route.find((point) => point.x === 2)!.traceThickness).toBe(1)
    expect(route!.route.at(-1)!.traceThickness).toBe(0.3)
    expect(route!.route.every((point) => point.y === 0 && point.z === 0)).toBe(true)
    expect(
      connectedQuery.mock.calls.some(([, id]) => id.startsWith("distant_")),
    ).toBe(false)
    connectedQuery.mockRestore()
  }
})
