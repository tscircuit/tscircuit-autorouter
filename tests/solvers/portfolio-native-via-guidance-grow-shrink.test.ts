import { expect, test } from "bun:test"
import {
  HighDensitySolverA01,
  HighDensitySolverA03,
} from "@tscircuit/high-density-a01"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type { ViaPlacement } from "lib/types/high-density-types"

test("A01 and A03 use original world via constraints through the grown portfolio", (): void => {
  for (const family of ["HIGH_DENSITY_A01", "HIGH_DENSITY_A03"] as const) {
    const observed: Array<ViaPlacement & { connectionName: string }> = []
    const solver = new GrowShrinkHighDensityIntraNodeSolver({
      nodeWithPortPoints: {
        capacityMeshNodeId: "native-guidance-world",
        center: { x: 10, y: 5 },
        width: 1.3,
        height: 0.9,
        availableZ: [1, 3],
        portPoints: [
          { x: 9.35, y: 5, z: 1, connectionName: "signal_mst17", rootConnectionName: "signal" },
          { x: 10.65, y: 5, z: 3, connectionName: "signal_mst17", rootConnectionName: "signal" },
        ],
      },
      layerCount: 4,
      viaDiameter: 0.3,
      traceWidth: 0.15,
      viaPlacementValidator: (placement, connectionName): boolean => {
        observed.push({ ...placement, connectionName })
        return placement.x > 10.12 && placement.x < 10.6 &&
          placement.y > 4.55 && placement.y < 5.45
      },
    })
    solver.scaleFactor = 4
    solver.growthAttempts = 2
    solver.step()
    const portfolio = solver.activeSubSolver
    expect(portfolio).not.toBeNull()
    const candidate = portfolio!.generateSolver({ [family]: true }) as unknown as
      HighDensitySolverA01 | HighDensitySolverA03
    expect(candidate instanceof (family === "HIGH_DENSITY_A01"
      ? HighDensitySolverA01 : HighDensitySolverA03)).toBeTrue()
    expect(candidate.nodeWithPortPoints.width).toBe(5.2)
    observed.length = 0
    candidate.solve()
    expect(candidate.solved).toBeTrue()
    expect(observed.length).toBeGreaterThan(0)
    expect(observed.every((placement) =>
      placement.connectionName === "signal_mst17" && placement.viaDiameter === 0.3 &&
      [1, 3].includes(placement.zStart) && [1, 3].includes(placement.zEnd) &&
      placement.zStart !== placement.zEnd &&
      placement.x >= 9.35 && placement.x <= 10.65 &&
      placement.y >= 4.55 && placement.y <= 5.45)).toBeTrue()
    const vias = candidate.getOutput().flatMap((route) => route.vias)
    expect(vias.length).toBeGreaterThan(0)
    for (const via of vias) {
      const world = { x: 10 + (via.x - 10) / 4, y: 5 + (via.y - 5) / 4 }
      expect(world.x).toBeGreaterThan(10.12)
      expect(world.x).toBeLessThan(10.6)
      expect(world.y).toBeGreaterThan(4.55)
      expect(world.y).toBeLessThan(5.45)
      expect(observed.some((placement) => placement.x === world.x && placement.y === world.y)).toBeTrue()
    }
  }
})
