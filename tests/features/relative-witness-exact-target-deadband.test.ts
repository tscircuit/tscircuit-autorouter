import { expect, test } from "bun:test"
import { checkPipeline9RelativeViaTraceClearance } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/checkPipeline9RelativeViaTraceClearance"
import { getPipeline9WitnessViaCertificate } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9WitnessViaCertificate"
import { relativeViaTraceAnonymousHardFixture } from "./relativeViaTraceAnonymousHardFixture"

test("exact target admission rejects the frozen native tolerance deadband and admits a positive minimum margin", () => {
  const input = relativeViaTraceAnonymousHardFixture()
  const baseline = getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, input.traces)
  const site = baseline.sites.find((value) => value.x === 0 && value.y === 0.728)!, trace = input.traces.find((value) => value.pcb_trace_id === "b-top-foreign")!
  const candidate = structuredClone(input.traces)
  for (const route of candidate) for (const point of route.route) if ((point.route_type === "wire" || point.route_type === "via") && point.x === site.x && point.y === site.y) point.y = 0.701
  const native = getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, candidate)
  expect(native.copper.checks.viaTrace.count).toBe(0)
  expect(checkPipeline9RelativeViaTraceClearance({ site, trace, target: { x: 0, y: 0.701 }, minimumClearance: 0.1 }).status).toBe("UNKNOWN")
  expect(checkPipeline9RelativeViaTraceClearance({ site, trace, target: { x: 0, y: 0.699 }, minimumClearance: 0.1 }).status).toBe("PASS")
})
