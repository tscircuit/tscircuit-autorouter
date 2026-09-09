import {
  HighDensitySolverA01,
  HighDensitySolverA03,
} from "@tscircuit/high-density-a01"
import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"

test("portfolio opts into physical via transitions", (): void => {
  const portfolio = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "physical-transitions",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      portPoints: [
        { x: -0.6, y: -0.6, z: 0, connectionName: "a" },
        { x: 0.6, y: 0.6, z: 3, connectionName: "a" },
        { x: 0.6, y: -0.6, z: 1, connectionName: "b" },
        { x: -0.6, y: 0.6, z: 2, connectionName: "b" },
      ],
    },
    traceWidth: 0.15,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
    obstacles: [],
    layerCount: 4,
  })
  const a01 = portfolio.generateSolver({
    HIGH_DENSITY_A01: true,
  }) as unknown as HighDensitySolverA01
  const a03 = portfolio.generateSolver({
    HIGH_DENSITY_A03: true,
  }) as unknown as HighDensitySolverA03
  expect(a01).toBeInstanceOf(HighDensitySolverA01)
  expect(a03).toBeInstanceOf(HighDensitySolverA03)
  expect(a01.viaOccupantQuery).toBe("row-runs")
  expect(a03.viaOccupantQuery).toBe("owner-runs")
  expect(a01.viaExpansion).toBe("physical")
  expect(a03.viaExpansion).toBe("physical")
  const directA01 = new HighDensitySolverA01({
    ...a01.getConstructorParams()[0],
    nodeWithPortPoints: structuredClone(a01.nodeWithPortPoints),
    viaExpansion: undefined,
    viaOccupantQuery: undefined,
  })
  const directA03 = new HighDensitySolverA03({
    ...a03.getConstructorParams()[0],
    nodeWithPortPoints: structuredClone(a03.nodeWithPortPoints),
    viaExpansion: undefined,
    viaOccupantQuery: undefined,
  })
  for (const [selected, direct] of [
    [a01, directA01],
    [a03, directA03],
  ] as const) {
    expect(direct.viaExpansion).toBe("per-layer")
    expect(direct.viaOccupantQuery).toBe("dense")
    selected.solve()
    direct.solve()
    expect(selected.solved).toBe(true)
    expect(direct.solved).toBe(true)
    expect(selected.getOutput()).toEqual(direct.getOutput())
    expect(selected.iterations).toBe(direct.iterations)
  }
})
