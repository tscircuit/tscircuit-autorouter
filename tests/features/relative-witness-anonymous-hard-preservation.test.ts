import { expect, test } from "bun:test"
import { Pipeline9RelativeWitnessRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RelativeWitnessRepairSolver"
import { relativeViaTraceAnonymousHardFixture } from "./relativeViaTraceAnonymousHardFixture"

test("an unchanged anonymous hard obstacle stays UNKNOWN with every duplicate raw-via finding and policy record retained", () => {
  const input = relativeViaTraceAnonymousHardFixture(), bytes = JSON.stringify(input)
  const solver = new Pipeline9RelativeWitnessRepairSolver(input)
  solver.solve()
  expect(solver.qualification).toMatchObject({ status: "LOCAL_REPAIRED", localRepaired: true, accepted: false, initialFullCertificateStatus: "UNKNOWN", finalFullCertificateStatus: "UNKNOWN", proposals: 1 })
  const before = solver.baselineGeometryDetails!, after = solver.finalGeometryDetails!
  const anonymous = before.srjObstacles.filter((record) => record.originalObstacleOwner.status === "UNKNOWN")
  expect(anonymous.filter((record) => record.finding.kind === "via")).toHaveLength(2)
  expect(before.viaPadPolicy).toHaveLength(1)
  expect(before.viaPadPolicy[0]!.raw.occurrences).toHaveLength(2)
  expect(before.viaPadPolicy[0]!.originalObstacleOwner).toEqual({ status: "UNKNOWN", reason: "Original obstacle lacks a resolved declared owner" })
  expect(after).toEqual(before)
  expect(solver.findingPreservation?.status).toBe("PASS")
  expect(solver.relativeProof?.status).toBe("PASS")
  expect(solver.selectedMoves.map((move) => move.kind)).toEqual(["via"])
  expect(solver.baselineCertificate!.srjObstacleViolationCount).toBeGreaterThan(0)
  expect(solver.finalCertificate!.srjObstacleViolationCount).toBe(solver.baselineCertificate!.srjObstacleViolationCount)
  expect(solver.finalCertificate!.viaPadPolicyViolationCount).toBe(1)
  expect(solver.finalCertificate!.reasons).toEqual(solver.baselineCertificate!.reasons)
  expect(JSON.stringify(input)).toBe(bytes)
})
