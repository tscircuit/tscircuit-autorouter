import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"

test("portfolio candidates receive the requested trace width", (): void => {
  for (const traceWidth of [0.1, 0.25]) {
    const portfolio = new PortfolioSingleIntraNodeSolver({
      nodeWithPortPoints: {
        capacityMeshNodeId: "width-forwarding",
        center: { x: 0, y: 0 },
        width: 4,
        height: 4,
        availableZ: [0, 1],
        portPoints: [
          { connectionName: "a", x: -2, y: 0, z: 0 },
          { connectionName: "a", x: 2, y: 0, z: 1 },
        ],
      },
      traceWidth,
    })
    for (const flag of [
      "CLOSED_FORM_TWO_TRACE_SAME_LAYER",
      "CLOSED_FORM_TWO_TRACE_TRANSITION_CROSSING",
      "CLOSED_FORM_SINGLE_TRANSITION",
      "MULTI_HEAD_POLYLINE_SOLVER",
    ]) {
      const candidate = portfolio.generateSolver({
        [flag]: true,
      }) as unknown as {
        traceThickness?: number
        traceWidth?: number
      }
      expect(candidate.traceThickness ?? candidate.traceWidth).toBe(traceWidth)
    }
  }
})
