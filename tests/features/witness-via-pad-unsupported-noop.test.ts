import { expect, test } from "bun:test"
import { Pipeline9WitnessViaPadRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9WitnessViaPadRepairSolver"
import { witnessViaPadRepairFixture } from "./witnessViaPadRepairFixture"

test("unsupported fixed copper remains a named UNKNOWN no-proposal outcome", () => {
  const input = witnessViaPadRepairFixture()
  input.originalSrj.obstacles.push({ type: "rect", center: { x: 3, y: 3 }, width: 0.3, height: 0.3, layers: ["top"], connectedTo: ["A"], circuitJsonMetadata: { pcb_via_id: "fixed-original-via" } })
  const solver = new Pipeline9WitnessViaPadRepairSolver(input)
  solver.solve()
  expect(solver.stats.status).toBe("NO_PROPOSAL")
  expect(solver.stats.finalCertificateStatus).toBe("UNKNOWN")
  expect(solver.stats.proposalCount).toBe(0)
  expect(solver.qualification.initialForeignViaPadFindings).toBe(null)
  expect(solver.qualification.bestForeignViaPadFindings).toBe(null)
  expect(solver.getOutput()).toBe(input.traces)
})
