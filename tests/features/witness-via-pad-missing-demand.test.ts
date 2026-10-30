import { expect, test } from "bun:test"
import { getPipeline9WitnessViaCertificate } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9WitnessViaCertificate"
import { witnessViaPadRepairFixture } from "./witnessViaPadRepairFixture"

test("entirely missing original demands cannot pass through empty trace validation", () => {
  const input = witnessViaPadRepairFixture(1)
  input.traces.pop()
  const certificate = getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, input.traces)
  expect(certificate.status).toBe("UNKNOWN")
  expect(certificate.reasons).toContain("An original net's demanded terminals lack one common physical component")
})
