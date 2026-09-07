import { expect, test } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver3 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("the portfolio forwards physical trace width to multi-head candidates", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "portfolio-parallel-node",
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    availableZ: [0, 1],
    portPoints: [
      { connectionName: "lower", x: -0.5, y: -0.25, z: 0 },
      { connectionName: "lower", x: 0.5, y: -0.25, z: 0 },
      { connectionName: "upper", x: -0.5, y: 0.25, z: 0 },
      { connectionName: "upper", x: 0.5, y: 0.25, z: 0 },
    ],
  }
  for (const width of [undefined, 0.1, 0.3, 0.5]) {
    const portfolio = new PortfolioSingleIntraNodeSolver({
      nodeWithPortPoints: node,
      traceWidth: width,
      viaDiameter: 0.3,
    })
    for (const boundaryPadding of [0.05, -0.05]) {
      const hyperParameters = {
        MULTI_HEAD_POLYLINE_SOLVER: true,
        SEGMENTS_PER_POLYLINE: 6,
        BOUNDARY_PADDING: boundaryPadding,
      }
      const candidate: unknown = portfolio.generateSolver(hyperParameters)
      expect(candidate).toBeInstanceOf(MultiHeadPolyLineIntraNodeSolver3)
      if (!(candidate instanceof MultiHeadPolyLineIntraNodeSolver3)) {
        throw new Error("Expected a multi-head portfolio candidate")
      }
      const direct = new MultiHeadPolyLineIntraNodeSolver3({
        nodeWithPortPoints: node,
        traceWidth: width,
        viaDiameter: 0.3,
        hyperParameters,
      })
      expect(candidate.traceWidth).toBe(width ?? 0.15)
      expect(candidate.maxViaCount).toBe(direct.maxViaCount)
      expect(candidate.minViaCount).toBe(direct.minViaCount)
      expect(candidate.viaDiameter).toBe(0.3)
      expect(candidate.obstacleMargin).toBe(0.1)
      expect(candidate.BOUNDARY_PADDING).toBe(boundaryPadding)
      expect(candidate.hyperParameters).toEqual(hyperParameters)
      expect(candidate.nodeWithPortPoints).toBe(node)
      expect(candidate.iterations).toBe(0)
    }
  }
})
