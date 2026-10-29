import { expect, test } from "bun:test"
import { Pipeline9WitnessViaPadRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9WitnessViaPadRepairSolver"
import { getPipeline9WitnessViaCertificate } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9WitnessViaCertificate"
import { witnessViaPadRepairFixture } from "./witnessViaPadRepairFixture"

test("reversed directed aliases retain exact canonical inventory and move every physical occurrence", () => {
  const input = witnessViaPadRepairFixture()
  const reverse = structuredClone(input.traces[0]!)
  reverse.pcb_trace_id = "a-reversed"
  reverse.route.reverse()
  for (const point of reverse.route) {
    if (point.route_type === "via") [point.from_layer, point.to_layer] = [point.to_layer, point.from_layer]
  }
  input.traces.push(reverse)
  const before = JSON.stringify(input)
  const initial = getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, input.traces)
  expect(initial.status).toBe("FAIL")
  expect(initial.reasons).not.toContain("Raw via inventory is not losslessly represented in export")
  expect(initial.demandsChecked).toBeGreaterThan(0)
  expect(initial.sites.length).toBe(2)
  expect(initial.circuitJson.filter((element) => element.type === "pcb_via").length).toBe(4)
  const solver = new Pipeline9WitnessViaPadRepairSolver(input)
  solver.solve()
  expect(solver.stats.status).toBe("ACCEPTED")
  expect(solver.stats.selectedViaOccurrenceCount).toBe(2)
  const output = solver.getOutput()
  const final = getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, output)
  expect(final.status).toBe("PASS")
  expect(final.reasons).toEqual([])
  const forwardVia = output[0]!.route[5]!
  const reverseVia = output[2]!.route[2]!
  if (forwardVia.route_type !== "via" || reverseVia.route_type !== "via") throw new Error("Synthetic selected via disappeared")
  expect(forwardVia.x).toBe(reverseVia.x)
  expect(forwardVia.y).toBe(reverseVia.y)
  for (const index of [0, 2]) {
    expect(output[index]!.route[0]).toEqual(input.traces[index]!.route[0])
    expect(output[index]!.route.at(-1)).toEqual(input.traces[index]!.route.at(-1))
  }
  expect(JSON.stringify(input)).toBe(before)
})
