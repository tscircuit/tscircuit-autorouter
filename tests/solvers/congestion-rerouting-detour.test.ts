import { expect, test } from "bun:test"
import { createCongestionFixture } from "../fixtures/congestion-rerouting"
import { CongestionReroutingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/CongestionReroutingSolver"

test("moves only one transit route around a congested region deterministically", (): void => {
  const outputs: string[] = []
  for (let iteration = 0; iteration < 2; iteration++) {
    const input = createCongestionFixture()
    const baseline = JSON.stringify(input.solver.state.regionSegments)
    const solver = new CongestionReroutingSolver(input)
    solver.solve()
    const output = solver.getOutput()
    expect(solver.stats.maxPf).toBe(0)
    expect(solver.accepted).toBe(1)
    expect(output.state.regionSegments[0].map(([routeId]) => routeId)).toEqual([1])
    expect(output.state.regionSegments[5].map(([routeId]) => routeId)).toEqual([0])
    expect(output.problem.routeStartPort).toEqual(input.solver.problem.routeStartPort)
    expect(output.problem.routeEndPort).toEqual(input.solver.problem.routeEndPort)
    expect(JSON.stringify(input.solver.state.regionSegments)).toBe(baseline)
    outputs.push(JSON.stringify(output.state.regionSegments))
  }
  expect(outputs[0]).toBe(outputs[1])
})
