import { expect, test } from "bun:test"
import { Pipeline9RelativeWitnessRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RelativeWitnessRepairSolver"
import { relativeViaTraceRepairFixture } from "./relativeViaTraceRepairFixture"

test("via-trace refinement also handles the same physical finding when native ownership correctly exposes it", () => {
  const input = relativeViaTraceRepairFixture()
  input.originalSrj.obstacles[2]!.center.x = 2
  input.originalSrj.connections[1]!.pointsToConnect[0]!.x = 2
  Object.assign(input.traces[1]!.route[0]!, { x: 2 })
  input.pointPairs = structuredClone(input.originalSrj)
  const solver = new Pipeline9RelativeWitnessRepairSolver(input)
  solver.solve()
  expect(solver.baselineCertificate!.referenceErrorCount).toBeGreaterThan(0)
  expect(solver.qualification).toMatchObject({ status: "LOCAL_REPAIRED", localRepaired: true, accepted: false, afterGeometryFindings: 0, finalFullCertificateStatus: "UNKNOWN" })
  expect(solver.finalCertificate!.referenceErrorCount).toBe(0)
  expect(solver.relativeProof!.status).toBe("PASS")
})
