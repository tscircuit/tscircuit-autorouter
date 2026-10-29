import { expect, test } from "bun:test"
import { getPipeline9WitnessViaCertificate } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9WitnessViaCertificate"
import { witnessViaPadRepairFixture } from "./witnessViaPadRepairFixture"

test("owner-blind dedup cannot hide an unselected conflicting raw via", () => {
  const input = witnessViaPadRepairFixture(1)
  const conflicting = structuredClone(input.traces[0]!)
  conflicting.pcb_trace_id = "foreign-hidden-via"
  conflicting.connection_name = "B"
  input.traces.push(conflicting)
  const certificate = getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, input.traces)
  expect(certificate.status).toBe("UNKNOWN")
  expect(certificate.reasons).toContain("Ambiguous coincident raw via ownership/material/span")
})
