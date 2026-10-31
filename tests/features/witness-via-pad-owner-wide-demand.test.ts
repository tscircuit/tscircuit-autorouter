import { expect, test } from "bun:test"
import { getPipeline9WitnessViaCertificate } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9WitnessViaCertificate"
import { witnessViaPadRepairFixture } from "./witnessViaPadRepairFixture"

test("individually routed pairs cannot certify disconnected islands of one original net", () => {
  const input = witnessViaPadRepairFixture(1)
  input.originalSrj.connections.push({ name: "A-extra", rootConnectionName: "A", pointsToConnect: [{ x: -3, y: -2, layer: "top" }, { x: -2, y: -2, layer: "top" }] })
  input.pointPairs = structuredClone(input.originalSrj)
  input.traces.push({ type: "pcb_trace", pcb_trace_id: "a-island", connection_name: "A-extra", route: [{ route_type: "wire", x: -3, y: -2, width: 0.1, layer: "top" }, { route_type: "wire", x: -2, y: -2, width: 0.1, layer: "top" }] })
  const certificate = getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, input.traces)
  expect(certificate.status).toBe("UNKNOWN")
  expect(certificate.reasons).toContain("An original net's demanded terminals lack one common physical component")
})
