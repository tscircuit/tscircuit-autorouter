import { expect, test } from "bun:test"
import { Pipeline9RelativeWitnessRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RelativeWitnessRepairSolver"
import { relativeWitnessRepairFixture } from "./relativeWitnessRepairFixture"

test("an unsupported physical domain returns unchanged explicit UNKNOWN without fabricated geometry counts", () => {
  const input = relativeWitnessRepairFixture()
  input.originalSrj.allowViaInPad = true
  input.pointPairs = structuredClone(input.originalSrj)
  const solver = new Pipeline9RelativeWitnessRepairSolver(input)
  solver.solve()
  expect(solver.qualification).toMatchObject({ status: "NO_PROPOSAL", localRepaired: false, accepted: false, initialFullCertificateStatus: "UNKNOWN", finalFullCertificateStatus: "UNKNOWN", beforeGeometryFindings: null, afterGeometryFindings: null })
  expect(solver.getOutput()).toBe(input.traces)
  expect(solver.selectedMoves).toEqual([])
  expect(solver.finalCertificate).toBe(solver.baselineCertificate)
})
