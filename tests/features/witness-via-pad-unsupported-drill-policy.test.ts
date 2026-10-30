import { expect, test } from "bun:test"
import { Pipeline9WitnessViaPadRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9WitnessViaPadRepairSolver"
import { witnessViaPadRepairFixture } from "./witnessViaPadRepairFixture"

test("unimplemented active drill policies stay explicit UNKNOWN with exact baseline output", () => {
  for (const rule of ["allowViaInPad", "minPlatedHoleDrillEdgeToDrillEdgeClearance"] as const) {
    const input = witnessViaPadRepairFixture()
    if (rule === "allowViaInPad") input.originalSrj.allowViaInPad = true
    else input.originalSrj.minPlatedHoleDrillEdgeToDrillEdgeClearance = 0.15
    const solver = new Pipeline9WitnessViaPadRepairSolver(input)
    solver.solve()
    expect(solver.stats.status).toBe("NO_PROPOSAL")
    expect(solver.stats.finalCertificateStatus).toBe("UNKNOWN")
    expect(solver.stats.proposalCount).toBe(0)
    expect(solver.getOutput()).toBe(input.traces)
  }
})
