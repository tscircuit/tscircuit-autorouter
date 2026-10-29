import { expect, test } from "bun:test"
import { getPipeline9WitnessViaCertificate } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9WitnessViaCertificate"
import { witnessViaPadRepairFixture } from "./witnessViaPadRepairFixture"

test("invalid explicit board and obstacle margins cannot waive physical constraints", () => {
  for (const value of [Number.NaN, -0.1, Number.POSITIVE_INFINITY]) {
    for (const key of ["minBoardEdgeClearance", "defaultObstacleMargin", "minTraceToHoleEdgeClearance"] as const) {
      const input = witnessViaPadRepairFixture(1)
      input.originalSrj[key] = value
      const certificate = getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, input.traces)
      expect(certificate.status).toBe("UNKNOWN")
      expect(certificate.reasons).toContain("Invalid explicit physical clearance")
      expect(certificate.referenceErrorCount).toBe(-1)
    }
  }
})
