import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"

test("geometric portfolio candidates receive the physical minimum trace width", (): void => {
  const portfolio = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "geometric-width-regression",
      center: { x: 0, y: 0 },
      width: 4,
      height: 4,
      availableZ: [0, 1],
      portPoints: [
        { x: -2, y: 0, z: 0, connectionName: "signal" },
        { x: 2, y: 0, z: 1, connectionName: "signal" },
      ],
    },
    traceWidth: 0.1524,
    minimumTraceWidth: 0.1524,
    viaDiameter: 0.2032,
  })
  for (const parameter of [
    "CLOSED_FORM_TWO_TRACE_SAME_LAYER",
    "CLOSED_FORM_TWO_TRACE_TRANSITION_CROSSING",
    "CLOSED_FORM_SINGLE_TRANSITION",
    "MULTI_HEAD_POLYLINE_SOLVER",
  ]) {
    const candidate = portfolio.generateSolver({
      [parameter]: true,
    }) as unknown as { traceThickness?: number; traceWidth?: number }
    expect(candidate.traceThickness ?? candidate.traceWidth).toBe(0.1524)
  }
})
