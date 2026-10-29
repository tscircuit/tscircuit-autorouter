import { expect, test } from "bun:test"
import type {
  HighDensitySolverA01,
  HighDensitySolverA03,
} from "@tscircuit/high-density-a01"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { ViaPlacement } from "lib/types/high-density-types"

test("native endpoint replacement still requires the original manufactured-via postcheck", (): void => {
  for (const family of ["HIGH_DENSITY_A01", "HIGH_DENSITY_A03"] as const) {
    const endpoint = { x: 10.033, y: 5.077 }
    const observed: Array<ViaPlacement & { connectionName: string }> = []
    const portfolio = new PortfolioSingleIntraNodeSolver({
      nodeWithPortPoints: {
        capacityMeshNodeId: "native-guidance-off-grid-endpoint",
        center: { x: 10, y: 5 },
        width: 2.3,
        height: 1.7,
        availableZ: [1, 3],
        portPoints: [
          { ...endpoint, z: 1, connectionName: "signal_mst17" },
          { ...endpoint, z: 3, connectionName: "signal_mst17" },
        ],
      },
      layerCount: 4,
      viaDiameter: 0.3,
      viaPlacementValidator: (placement, connectionName): boolean => {
        observed.push({ ...placement, connectionName })
        return Math.hypot(placement.x - endpoint.x, placement.y - endpoint.y) > 1e-8
      },
    })
    const hyperParameters = { [family]: true }
    const candidate = portfolio.generateSolver(hyperParameters)
    candidate.solve()
    expect(candidate.solved).toBeTrue()
    const native = candidate as unknown as HighDensitySolverA01 | HighDensitySolverA03
    const routes = native.getOutput()
    expect(routes).toHaveLength(1)
    expect(routes[0]!.route.map(({ x, y, z }) => ({ x, y, z }))).toEqual([
      { ...endpoint, z: 1 },
      { ...endpoint, z: 3 },
    ])
    expect(routes[0]!.vias).toHaveLength(1)
    const via = routes[0]!.vias[0]!
    expect(Math.hypot(via.x - endpoint.x, via.y - endpoint.y)).toBeGreaterThan(1e-8)
    expect(observed.some((placement) => placement.x === via.x && placement.y === via.y)).toBeTrue()
    expect(observed.some((placement) => placement.x === endpoint.x && placement.y === endpoint.y)).toBeFalse()

    // The real candidate has two grid states. Replacing both with exact
    // terminals moves its manufactured transition away from the queried site.
    portfolio.onSolve({ solver: candidate, hyperParameters, h: 0, g: 0, f: 0 })
    expect(observed.at(-1)).toMatchObject({
      ...endpoint, zStart: 0, zEnd: 3, viaDiameter: 0.3, connectionName: "signal_mst17",
    })
    expect(candidate.solved).toBeFalse()
    expect(candidate.failed).toBeTrue()
    expect(candidate.error).toBe("Candidate via placement violates original board constraints")
    expect(portfolio.solvedRoutes).toEqual([])
    expect(portfolio.stats.viaPlacementCandidateRejectionCount).toBe(1)
  }
})
