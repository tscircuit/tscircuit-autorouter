import { expect, test } from "bun:test"
import { getPipeline9WitnessViaCertificate } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9WitnessViaCertificate"
import { witnessViaPadRepairFixture } from "./witnessViaPadRepairFixture"

test("nonempty generic obstacle aliases cannot hide a foreign or unowned wire contact", () => {
  for (const aliases of [[], ["unresolved-generic-keepout"], ["A"]]) {
    const input = witnessViaPadRepairFixture(1)
    input.originalSrj.obstacles.push({ type: "rect", center: { x: 0.08, y: -1 }, width: 0.1, height: 0.1, layers: ["top"], connectedTo: aliases })
    input.pointPairs = structuredClone(input.originalSrj)
    const certificate = getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, input.traces)
    expect(certificate.status).toBe("FAIL")
    expect(certificate.srjObstacleViolationCount).toBeGreaterThan(0)
    expect(certificate.reasons).toContain("Original SRJ obstacle-envelope violations remain")
  }
})
