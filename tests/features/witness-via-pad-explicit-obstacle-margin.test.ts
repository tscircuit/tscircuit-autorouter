import { expect, test } from "bun:test"
import { Pipeline9WitnessViaPadRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9WitnessViaPadRepairSolver"
import { getPipeline9WitnessViaCertificate } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9WitnessViaCertificate"
import { witnessViaPadRepairFixture } from "./witnessViaPadRepairFixture"

test("pad-face geometry preserves an explicitly requested SRJ obstacle margin", () => {
  const input = witnessViaPadRepairFixture()
  input.originalSrj.defaultObstacleMargin = 0.15
  input.pointPairs.defaultObstacleMargin = 0.15
  const solver = new Pipeline9WitnessViaPadRepairSolver(input)
  solver.solve()
  const via = solver.getOutput()[0]!.route[5]!
  if (via.route_type !== "via") throw new Error("Expected unchanged via topology")
  expect(via.y).toBeCloseTo(0.80001, 9)
  const certificate = getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, solver.getOutput())
  expect(certificate.status).toBe("PASS")
  expect(certificate.viaPadPolicyViolationCount).toBe(0)
  expect(input.originalSrj.defaultObstacleMargin).toBe(0.15)
})
