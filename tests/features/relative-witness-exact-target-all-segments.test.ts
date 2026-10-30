import { expect, test } from "bun:test"
import { checkPipeline9RelativeViaTraceClearance } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/checkPipeline9RelativeViaTraceClearance"
import { getPipeline9WitnessViaCertificate } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9WitnessViaCertificate"
import { relativeViaTraceAnonymousHardFixture } from "./relativeViaTraceAnonymousHardFixture"

test("another target segment becoming closest is checked on every manufactured via layer", () => {
  const input = relativeViaTraceAnonymousHardFixture(), certificate = getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, input.traces)
  const site = certificate.sites[0]!, target = { x: 0, y: 0 }
  const trace = { type: "pcb_trace" as const, pcb_trace_id: "foreign-bend", connection_name: "B", route: [
    { route_type: "wire" as const, x: -1, y: 0.301, width: 0.1, layer: "bottom" },
    { route_type: "wire" as const, x: 0, y: 0.301, width: 0.1, layer: "bottom" },
  ] }
  expect(checkPipeline9RelativeViaTraceClearance({ site, target, trace, minimumClearance: 0.1 }).status).toBe("PASS")
  trace.route.push({ route_type: "wire", x: 0.299, y: 0, width: 0.1, layer: "bottom" })
  expect(checkPipeline9RelativeViaTraceClearance({ site, target, trace, minimumClearance: 0.1 }).status).toBe("UNKNOWN")
  expect(checkPipeline9RelativeViaTraceClearance({ site, target, trace, minimumClearance: NaN }).status).toBe("UNKNOWN")
})
