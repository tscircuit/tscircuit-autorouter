import { expect, test } from "bun:test"
import { Pipeline9RelativeWitnessRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RelativeWitnessRepairSolver"
import { getPipeline9WitnessViaCertificate } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9WitnessViaCertificate"
import { jointRelativeWitnessRepairFixture } from "./relativeWitnessRepairFixture"

test("bounded joint local repair clears geometry while retaining a full UNKNOWN certificate and protected inputs", () => {
  const input = jointRelativeWitnessRepairFixture(), bytes = JSON.stringify(input)
  const solver = new Pipeline9RelativeWitnessRepairSolver(input)
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.qualification).toMatchObject({ status: "LOCAL_REPAIRED", localRepaired: true, accepted: false, initialFullCertificateStatus: "UNKNOWN", finalFullCertificateStatus: "UNKNOWN", relativeStatus: "PASS", proposals: 1, beforeGeometryFindings: 4, afterGeometryFindings: 0 })
  expect(solver.relativeProof).toMatchObject({ status: "PASS", bundleCount: 2, boundaryCount: 4 })
  expect(solver.selectedMoves.map((move) => move.kind)).toEqual(["via", "wire"])
  expect(solver.MAX_ITERATIONS).toBe(20)
  expect(solver.iterations).toBeLessThanOrEqual(20)
  expect(solver.finalCertificate).toEqual(getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, solver.getOutput()))
  expect(solver.baselineCertificate).toEqual(getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, input.traces))
  expect(solver.finalCertificate!.reasons).toEqual(solver.baselineCertificate!.reasons.filter((reason) => reason !== "Original SRJ obstacle-envelope violations remain"))
  expect(JSON.stringify(input)).toBe(bytes)
})
