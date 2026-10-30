import { expect, test } from "bun:test"
import { Pipeline9RelativeWitnessRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RelativeWitnessRepairSolver"
import { getPipeline9WitnessViaCertificate } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9WitnessViaCertificate"
import { relativeViaTraceExistingDefectsFixture } from "./relativeViaTraceExistingDefectsFixture"

test("a bounded via repair preserves each existing SRJ finding while global UNKNOWN stays unresolved", () => {
  const input = relativeViaTraceExistingDefectsFixture(), bytes = JSON.stringify(input)
  const solver = new Pipeline9RelativeWitnessRepairSolver(input)
  solver.solve()
  expect(solver.qualification).toMatchObject({ status: "LOCAL_REPAIRED", localRepaired: true, accepted: false, initialFullCertificateStatus: "UNKNOWN", finalFullCertificateStatus: "UNKNOWN", beforeGeometryFindings: 3, afterGeometryFindings: 2, proposals: 1 })
  expect(solver.stats).toMatchObject({ acceptanceMode: "EXACT_UNTARGETED_FINDINGS", targetFindingCountBefore: 1, targetFindingCountAfter: 0, untargetedFindingsPreserved: true })
  expect(solver.baselineGeometryDetails!.srjObstacles).toHaveLength(2)
  expect(solver.finalGeometryDetails).toEqual(solver.baselineGeometryDetails)
  expect(solver.findingPreservation?.status).toBe("PASS")
  expect(solver.relativeProof).toMatchObject({ status: "PASS", bundleCount: 1, boundaryCount: 2 })
  expect(solver.selectedMoves.map((move) => move.kind)).toEqual(["via"])
  expect(solver.finalCertificate!.copper.allFindings).toEqual([])
  expect(solver.finalCertificate!.reasons).toEqual(solver.baselineCertificate!.reasons)
  expect(solver.finalCertificate).toEqual(getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, solver.getOutput()))
  expect(JSON.stringify(input)).toBe(bytes)
})
