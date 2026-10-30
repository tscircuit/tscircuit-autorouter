import { expect, test } from "bun:test"
import { Pipeline9WitnessViaPadRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9WitnessViaPadRepairSolver"
import { getPipeline9WitnessViaCertificate } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9WitnessViaCertificate"
import { witnessViaPadRepairFixture } from "./witnessViaPadRepairFixture"

test("different transition endpoints still describe the same full-stack manufactured through-via", () => {
  const input = witnessViaPadRepairFixture()
  const alias = structuredClone(input.traces[0]!)
  alias.pcb_trace_id = "a-other-inner-transition"
  for (const point of alias.route) {
    if (point.route_type === "wire" && point.layer === "inner1") point.layer = "inner2"
    if (point.route_type === "via") {
      if (point.from_layer === "inner1") point.from_layer = "inner2"
      if (point.to_layer === "inner1") point.to_layer = "inner2"
    }
  }
  input.traces.push(alias)
  const initial = getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, input.traces)
  expect(initial.status).toBe("FAIL")
  expect(initial.reasons).not.toContain("Raw via inventory is not losslessly represented in export")
  expect(initial.demandsChecked).toBeGreaterThan(0)
  expect(initial.sites.length).toBe(2)
  const vias = initial.circuitJson.filter((element) => element.type === "pcb_via")
  expect(vias.length).toBe(4)
  for (const via of vias) expect(via.layers).toEqual(["top", "inner1", "inner2", "bottom"])
  const solver = new Pipeline9WitnessViaPadRepairSolver(input)
  solver.solve()
  expect(solver.stats.status).toBe("ACCEPTED")
  expect(solver.stats.selectedViaOccurrenceCount).toBe(2)
  const output = solver.getOutput()
  const final = getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, output)
  expect(final.status).toBe("PASS")
  expect(final.reasons).toEqual([])
  const firstVia = output[0]!.route[5]!
  const aliasVia = output[2]!.route[5]!
  if (firstVia.route_type !== "via" || aliasVia.route_type !== "via") throw new Error("Synthetic selected via disappeared")
  expect(firstVia).toEqual({ ...aliasVia, from_layer: "inner1" })
  expect(output[2]!.route[2]).toEqual(alias.route[2])
})
