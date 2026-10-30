import { expect, test } from "bun:test"
import { Pipeline9WitnessViaPadRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9WitnessViaPadRepairSolver"
import { getPipeline9WitnessViaCertificate } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9WitnessViaCertificate"
import { witnessViaPadRepairFixture } from "./witnessViaPadRepairFixture"

test("a foreign-clearance repair cannot introduce forbidden own-net via-in-pad", () => {
  const input = witnessViaPadRepairFixture()
  input.originalSrj.obstacles.push({ type: "rect", center: { x: 0, y: 0.858 }, width: 0.1, height: 0.1, layers: ["top"], connectedTo: ["A", "A0"], circuitJsonMetadata: { pcb_smtpad_id: "own-pad-nearby", pcb_port_id: "A0" } })
  input.pointPairs = structuredClone(input.originalSrj)
  const initial = getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, input.traces)
  expect(initial.viaInPadViolationCount).toBe(0)
  const solver = new Pipeline9WitnessViaPadRepairSolver(input)
  solver.solve()
  expect(solver.stats.status).toBe("ACCEPTED")
  expect(solver.stats.proposalCount).toBeGreaterThan(1)
  const final = getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, solver.getOutput())
  expect(final.status).toBe("PASS")
  expect(final.viaInPadViolationCount).toBe(0)
})
