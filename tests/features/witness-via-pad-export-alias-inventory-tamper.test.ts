import { expect, spyOn, test } from "bun:test"
import { getPipeline9WitnessViaCertificate } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9WitnessViaCertificate"
import * as relaxedDrc from "lib/testing/evaluate-relaxed-drc"
import { witnessViaPadRepairFixture } from "./witnessViaPadRepairFixture"

test("every exported transition alias retains exact count, ordering, identity, material and manufactured span", () => {
  const input = witnessViaPadRepairFixture(1)
  const reverse = structuredClone(input.traces[0]!)
  reverse.pcb_trace_id = "a-reversed"
  reverse.route.reverse()
  for (const point of reverse.route) {
    if (point.route_type === "via") [point.from_layer, point.to_layer] = [point.to_layer, point.from_layer]
  }
  input.traces.push(reverse)
  expect(getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, input.traces).status).toBe("PASS")
  const native = relaxedDrc.evaluateRelaxedDrc
  const changes = ["extra", "missing", "outer", "drill", "span", "trace", "identity", "order", "duplicate"]
  for (const change of changes) {
    const interception = spyOn(relaxedDrc, "evaluateRelaxedDrc").mockImplementation((params) => {
      const result = native(params)
      const indices = result.circuitJson.flatMap((element, index) => element.type === "pcb_via" ? [index] : [])
      const first = result.circuitJson[indices[0]!]
      if (first?.type !== "pcb_via") throw new Error("Synthetic canonical via disappeared")
      if (change === "extra") result.circuitJson.push({ ...first, pcb_via_id: "unaccounted", x: 2 })
      else if (change === "missing") result.circuitJson.splice(indices[0]!, 1)
      else if (change === "outer") first.outer_diameter = 0.4
      else if (change === "drill") first.hole_diameter = 0.1
      else if (change === "span") first.layers = ["top", "bottom"]
      else if (change === "trace") first.pcb_trace_id = "b"
      else if (change === "identity") first.pcb_via_id = "unbound-via"
      else if (change === "order") [result.circuitJson[indices[0]!], result.circuitJson[indices[1]!]] = [result.circuitJson[indices[1]!]!, first]
      else result.circuitJson[indices.at(-1)!] = { ...first }
      return result
    })
    try {
      const certificate = getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, input.traces)
      expect(certificate.status).toBe("UNKNOWN")
      expect(certificate.reasons.some((reason) => reason === "Raw via inventory is not losslessly represented in export" || reason === "Unaccounted exported via geometry")).toBe(true)
    } finally {
      interception.mockRestore()
    }
  }
  expect(getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, input.traces).status).toBe("PASS")
})
