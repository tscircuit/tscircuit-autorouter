import { expect, test } from "bun:test"
import { Pipeline9RelativeWitnessRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RelativeWitnessRepairSolver"
import { getPipeline9WitnessViaCertificate } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9WitnessViaCertificate"
import { relativeViaTraceRepairFixture } from "./relativeViaTraceRepairFixture"

test("a through-via foreign-wire defect on an unused signal layer is repaired with the same relative interface proof", () => {
  const input = relativeViaTraceRepairFixture(), bytes = JSON.stringify(input)
  const solver = new Pipeline9RelativeWitnessRepairSolver(input)
  solver.solve()
  expect(solver.qualification).toMatchObject({ status: "LOCAL_REPAIRED", localRepaired: true, accepted: false, initialFullCertificateStatus: "UNKNOWN", finalFullCertificateStatus: "UNKNOWN", afterGeometryFindings: 0 })
  expect(solver.baselineCertificate!.copper.allFindings).toHaveLength(1)
  expect(solver.baselineCertificate!.copper.allFindings[0].checkClass).toBe("viaTrace")
  expect(solver.relativeProof).toMatchObject({ status: "PASS", bundleCount: 1, boundaryCount: 2 })
  expect(solver.selectedMoves).toHaveLength(1)
  expect(solver.selectedMoves[0]!.kind).toBe("via")
  expect(solver.selectedMoves[0]!.occurrences.map((value) => value.pointIndex)).toEqual([6, 7, 8])
  expect(solver.getOutput()[0]!.route[7]).toMatchObject({ route_type: "via", from_layer: "inner1", to_layer: "bottom", via_diameter: 0.3, via_hole_diameter: 0.15 })
  expect(solver.finalCertificate).toEqual(getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, solver.getOutput()))
  expect(JSON.stringify(input)).toBe(bytes)
})
