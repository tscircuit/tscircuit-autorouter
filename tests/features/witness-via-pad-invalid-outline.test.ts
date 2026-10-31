import { expect, test } from "bun:test"
import { getPipeline9WitnessViaCertificate } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9WitnessViaCertificate"
import { witnessViaPadRepairFixture } from "./witnessViaPadRepairFixture"

test("self-intersecting or degenerate outlines cannot certify via copper", () => {
  for (const outline of [
    [{ x: -4, y: -4 }, { x: 4, y: 4 }, { x: -4, y: 4 }, { x: 4, y: -4 }],
    [{ x: -4, y: 0 }, { x: 0, y: 0 }, { x: 4, y: 0 }],
  ]) {
    const input = witnessViaPadRepairFixture(1)
    input.originalSrj.outline = outline
    const certificate = getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, input.traces)
    expect(certificate.status).toBe("UNKNOWN")
    expect(certificate.referenceErrorCount).toBe(-1)
  }
})
