import { expect, test } from "bun:test"
import { getPipeline9WitnessViaCertificate } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9WitnessViaCertificate"
import { Pipeline9WitnessViaPadRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9WitnessViaPadRepairSolver"
import { witnessViaPadRepairFixture } from "./witnessViaPadRepairFixture"

test("repairs a declared foreign via-pad defect hidden by cross-layer canonical aliases", () => {
  const input = witnessViaPadRepairFixture()
  const before = JSON.stringify(input)
  const initial = getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, input.traces)
  expect(initial.referenceErrorCount).toBe(0)
  expect(initial.status).toBe("FAIL")
  expect(initial.copper.allFindings).toHaveLength(1)
  expect(initial.copper.allFindings[0].error.actual_clearance).toBeCloseTo(0.078, 9)
  const solver = new Pipeline9WitnessViaPadRepairSolver(input)
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.stats.status).toBe("ACCEPTED")
  const output = solver.getOutput()
  const final = getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, output)
  expect(final.status).toBe("PASS")
  expect(final.demandsChecked).toBe(2)
  expect(final.copper.allFindings).toHaveLength(0)
  expect(final.referenceErrorCount).toBe(0)
  const via = output[0]!.route[5]!
  if (via.route_type !== "via") throw new Error("Expected the same via primitive")
  expect(via.y).toBeCloseTo(0.75001, 9)
  for (const index of [4, 5, 6]) {
    const point = output[0]!.route[index]!
    if (point.route_type !== "wire" && point.route_type !== "via") throw new Error("Unexpected primitive")
    expect(point.y).toBe(via.y)
  }
  expect(output[0]!.route[2]).toEqual(input.traces[0]!.route[2])
  expect(output[1]).toEqual(input.traces[1])
  expect(JSON.stringify(input)).toBe(before)
})
