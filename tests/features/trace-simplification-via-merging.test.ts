import { expect, test, describe } from "bun:test"
import { TraceSimplificationSolver } from "../../lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import { HighDensityRoute } from "../../lib/types/high-density-types"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"

describe("TraceSimplificationSolver via merging", () => {
  test("should merge vias that become coincident after path simplification", () => {
    // Two routes on the same net "net1"
    // They both have a via, but they are slightly offset
    // Path simplification should ideally bring them to the same point
    const hdRoutes: HighDensityRoute[] = [
      {
        connectionName: "conn1",
        traceThickness: 0.2,
        viaDiameter: 0.6,
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 10, z: 0 },
          { x: 10, y: 10, z: 1 },
          { x: 20, y: 10, z: 1 },
        ],
        vias: [{ x: 10, y: 10 }],
      },
      {
        connectionName: "conn2",
        traceThickness: 0.2,
        viaDiameter: 0.6,
        route: [
          { x: 0, y: 0.1, z: 0 },
          { x: 10.1, y: 10.1, z: 0 },
          { x: 10.1, y: 10.1, z: 1 },
          { x: 20, y: 10.1, z: 1 },
        ],
        vias: [{ x: 10.1, y: 10.1 }],
      },
    ]

    // Create a connectivity map where both connections are on the same net
    const connMap = new ConnectivityMap({
      net1: ["conn1", "conn2"],
    })
    // Mock idToNetMap which is used by SameNetViaMergerSolver
    // SameNetViaMergerSolver uses: this.connMap?.idToNetMap[route.connectionName]
    ;(connMap as any).idToNetMap = {
      conn1: "net1",
      conn2: "net1",
    }

    const solver = new TraceSimplificationSolver({
      hdRoutes,
      obstacles: [],
      connMap,
      colorMap: { conn1: "red", conn2: "blue" },
      defaultViaDiameter: 0.6,
      layerCount: 2,
    })

    // Run the solver
    solver.solve()

    expect(solver.solved).toBe(true)

    // Total vias initially: 2
    // If they were merged, they should have the same position
    const finalRoutes = solver.simplifiedHdRoutes
    const allVias = finalRoutes.flatMap((r) => r.vias)
    const uniqueVias = new Set(
      allVias.map((v) => `${v.x.toFixed(4)},${v.y.toFixed(4)}`),
    )

    // Verify that the vias were merged into a single location
    expect(uniqueVias.size).toBe(1)

    // Snapshot visualization for regression testing and proof of fix
    expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
  })
})
