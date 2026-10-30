import { relativeViaTraceExistingDefectsFixture } from "./relativeViaTraceExistingDefectsFixture"

export function relativeViaTraceAnonymousHardFixture(): ReturnType<typeof relativeViaTraceExistingDefectsFixture> {
  const input = relativeViaTraceExistingDefectsFixture()
  input.originalSrj.obstacles.push({ componentId: "anonymous-body", type: "rect", center: { x: -2, y: 2 }, width: 1, height: 1, layers: ["top", "inner1", "inner2", "bottom"], connectedTo: [] })
  input.traces.push({ type: "pcb_trace", pcb_trace_id: "d-fixed-via", connection_name: "D", route: [
    { route_type: "wire", x: -0.8, y: 2, layer: "top", width: 0.1 },
    { route_type: "wire", x: -1.4, y: 2, layer: "top", width: 0.1 },
    { route_type: "via", x: -1.4, y: 2, from_layer: "top", to_layer: "bottom", via_diameter: 0.3, via_hole_diameter: 0.15 },
    { route_type: "wire", x: -1.4, y: 2, layer: "bottom", width: 0.1 },
    { route_type: "wire", x: -0.8, y: 2, layer: "bottom", width: 0.1 },
  ] })
  input.traces.push({ ...structuredClone(input.traces[input.traces.length - 1]!), pcb_trace_id: "d-fixed-via-second-occurrence" })
  input.pointPairs = structuredClone(input.originalSrj)
  return input
}
