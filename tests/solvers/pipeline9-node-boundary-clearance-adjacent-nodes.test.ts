import { expect, test } from "bun:test"
import { segmentDistance } from "high-density-repair02/lib/high-density-repair-solver/functions/segmentDistance"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("Pipeline9 boundary repair validates current adjacent-node copper", () => {
  for (const signs of [[1, -1], [-1, 1]]) {
    const nodes: NodeWithPortPoints[] = signs.map((sign) => ({
      capacityMeshNodeId: `node${sign}`,
      center: { x: 0, y: sign },
      width: 2,
      height: 2,
      availableZ: [0, 1],
      portPoints: [],
    }))
    const routes: HighDensityRoute[] = signs.map((sign) => ({
      connectionName: `trace${sign}`,
      regionId: `node${sign}`,
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -1, y: sign * 0.21, z: 0 },
        { x: 1, y: sign * 0.21, z: 0 },
      ],
    }))
    const obstacles: Obstacle[] = signs.map((sign) => ({
      type: "rect",
      center: { x: -0.3, y: sign * 0.45 },
      width: 0.8,
      height: 0.4,
      layers: ["top"],
      connectedTo: [],
    }))
    const solver = new Pipeline4HighDensityRepairSolver({
      nodeWithPortPoints: nodes,
      hdRoutes: routes,
      obstacles,
      enableNodeBoundaryClearanceRepair: true,
    })
    while (solver.activeSampleIndex < solver.sampleEntries.length) {
      solver.step()
    }
    expect(solver.stats.nodeBoundaryClearanceCandidateCount).toBe(0)
    expect(solver.stats.nodeClearanceFinalConflictCount).toBe(2)
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.stats.nodeBoundaryClearanceResolvedConflictCount).toBe(1)
    expect(solver.stats.nodeClearanceFinalConflictCount).toBe(1)
    const [first, second] = solver.getOutput()
    // Both repairs pass against the original neighboring route, but accepting
    // both creates a 0.0978 mm gap. Keep the second route when its proposed
    // dogleg conflicts with the first node's already accepted copper.
    expect(second!.route).toEqual(routes[1]!.route)
    for (let i = 1; i < first!.route.length; i++) {
      for (let j = 1; j < second!.route.length; j++) {
        expect(
          segmentDistance(
            first!.route[i - 1]!,
            first!.route[i]!,
            second!.route[j - 1]!,
            second!.route[j]!,
          ) - 0.1,
        ).toBeGreaterThanOrEqual(0.1 - 1e-9)
      }
    }
  }
})
