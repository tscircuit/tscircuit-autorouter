import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { MultiHeadPolyLineIntraNodeSolver3 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import type { PolyLine2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types2"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("the portfolio forwards board drill geometry independently from copper annulus diameter", (): void => {
  const lines: PolyLine2[] = [0, 0.3].map((y, index) => ({
    connectionName: `branch-${index}`,
    start: { x: -1, y, z1: 0, z2: 0 },
    mPoints: [{ x: 0, y, z1: 0, z2: 1 }],
    end: { x: 1, y, z1: 1, z2: 1 },
  }))
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "portfolio-drill-geometry",
    center: { x: 0, y: 0 },
    width: 4,
    height: 4,
    availableZ: [0, 1],
    portPoints: lines.flatMap((line) => [
      {
        connectionName: line.connectionName,
        x: line.start.x,
        y: line.start.y,
        z: line.start.z1,
      },
      {
        connectionName: line.connectionName,
        x: line.end.x,
        y: line.end.y,
        z: line.end.z2,
      },
    ]),
  }
  const connMap = new ConnectivityMap({ ground: ["branch-0", "branch-1"] })
  for (const [gap, expected] of [
    [0.1, true],
    [0.2, false],
  ] as const) {
    const portfolio = new PortfolioSingleIntraNodeSolver({
      nodeWithPortPoints,
      connMap,
      viaDiameter: 0.6,
      viaHoleDiameter: 0.15,
      minViaHoleEdgeToViaHoleEdgeClearance: gap,
    })
    const solver = portfolio.generateSolver({
      MULTI_HEAD_POLYLINE_SOLVER: true,
    }) as unknown as MultiHeadPolyLineIntraNodeSolver3
    expect(solver).toBeInstanceOf(MultiHeadPolyLineIntraNodeSolver3)
    expect(
      solver.checkIfSolved({
        polyLines: lines,
        minGaps: solver.computeMinGapBtwPolyLines(lines),
      }),
    ).toBe(expected)
  }
})
