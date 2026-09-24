import { expect, test } from "bun:test"
import { LocalDrcRepairSolver } from "lib/solvers/LocalDrcRepairSolver/LocalDrcRepairSolver"
import { createLocalDrcRepairFixture } from "../fixtures/local-drc-repair-fixture"

test("cleanup preserves fixed copper, replacement traces, buses and differential pairs", (): void => {
  for (const protection of ["fixed", "replacement", "bus", "pair"]) {
    const input = createLocalDrcRepairFixture()
    const signal = input.traces[3]!
    if (protection === "fixed") { input.fixedTraces.push(signal); input.traces.splice(3, 1) }
    if (protection === "replacement") signal.__replaces_pcb_trace_id = "original_signal"
    if (protection === "bus") input.originalSrj.buses = [{ busId: "bus", connectionNames: ["signal"], maxLengthSkew: 0.001 }]
    if (protection === "pair") input.originalSrj.differentialPairs = [{ connectionNames: ["signal", "foreign"], lengthTolerance: 0.001 }]
    const original = structuredClone(signal)
    const solver = new LocalDrcRepairSolver(input)
    solver.solve()
    expect(solver.failed, solver.error ?? "").toBeFalse()
    expect([...solver.getOutput(), ...input.fixedTraces].find((trace) => trace.pcb_trace_id === "signal"), protection).toEqual(original)
  }
})
