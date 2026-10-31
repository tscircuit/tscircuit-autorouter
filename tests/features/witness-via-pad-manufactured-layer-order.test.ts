import { expect, test } from "bun:test"
import { getPipeline9WitnessViaCertificate } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9WitnessViaCertificate"
import { witnessViaPadRepairFixture } from "./witnessViaPadRepairFixture"

test("permuting a manufactured layer set cannot hide a bottom fixed-obstacle contact", () => {
  const statuses = []
  for (const layers of [["top", "inner1", "inner2", "bottom"], ["top", "bottom", "inner1", "inner2"]]) {
    const input = witnessViaPadRepairFixture(1)
    input.originalSrj.allowBlindAndBuriedVias = true
    input.pointPairs.allowBlindAndBuriedVias = true
    input.originalSrj.obstacles.push({ type: "rect", center: { x: -1, y: 1.5 }, width: 0.1, height: 0.1, layers: ["bottom"], connectedTo: [] })
    for (const trace of input.traces) for (const point of trace.route) if (point.route_type === "via") point.layers = [...layers]
    const certificate = getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, input.traces)
    expect(certificate.status).toBe("FAIL")
    expect(certificate.srjObstacleViolationCount).toBeGreaterThan(0)
    statuses.push(certificate.srjObstacleViolationCount)
  }
  expect(statuses[0]).toBe(statuses[1])
})
