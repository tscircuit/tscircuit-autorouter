import { expect, test } from "bun:test"
import { Pipeline9WitnessViaPadRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9WitnessViaPadRepairSolver"
import { witnessViaPadRepairFixture } from "./witnessViaPadRepairFixture"

test("rejected planned proposals retain failure rather than returning an invalid incumbent", () => {
  const input = witnessViaPadRepairFixture()
  for (const obstacle of [
    { x: 0, y: 1.029, width: 0.4, height: 0.1 },
    { x: 0, y: -1.029, width: 0.4, height: 0.1 },
    { x: 1.029, y: 0.728, width: 0.1, height: 0.4 },
    { x: -1.029, y: 0.728, width: 0.1, height: 0.4 },
  ]) input.originalSrj.obstacles.push({ type: "rect", center: { x: obstacle.x, y: obstacle.y }, width: obstacle.width, height: obstacle.height, layers: ["bottom"], connectedTo: [] })
  const solver = new Pipeline9WitnessViaPadRepairSolver(input)
  expect(() => solver.solve()).toThrow("exhausted its planned candidates")
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.stats.status).toBe("SEARCH_EXHAUSTED")
  expect(solver.stats.proposalCount).toBe(4)
  expect(solver.failureEvidence?.attemptedCandidates).toBe(4)
  const ledger = solver.stats.candidateLedger as { foreignViaPadFindings: number; srjObstacleViolations: number; status: string }[]
  expect(ledger.some((candidate) => candidate.foreignViaPadFindings === 0 && candidate.srjObstacleViolations > 0 && candidate.status !== "PASS")).toBe(true)
  expect(solver.qualification.bestForeignViaPadFindings).toBe(0)
  expect(solver.qualification.accepted).toBe(0)
  expect(solver.qualification.status).toBe("SEARCH_EXHAUSTED")
  expect(solver.qualification.protectedUnchanged).toBe(true)
  expect(() => solver.getOutput()).toThrow("requires completed successful")
})
