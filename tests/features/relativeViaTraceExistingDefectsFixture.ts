import { jointRelativeWitnessRepairFixture } from "./relativeWitnessRepairFixture"

export function relativeViaTraceExistingDefectsFixture(): ReturnType<typeof jointRelativeWitnessRepairFixture> {
  const input = jointRelativeWitnessRepairFixture()
  Object.assign(input.originalSrj.obstacles[2]!, { width: 0.4, height: 0.2 })
  input.traces.push({ type: "pcb_trace", pcb_trace_id: "b-top-foreign", connection_name: "B", route: [
    { route_type: "wire", x: -0.8, y: 1, layer: "top", width: 0.1 },
    { route_type: "wire", x: 0.8, y: 1, layer: "top", width: 0.1 },
  ] })
  input.traces.push({ ...structuredClone(input.traces[2]!), pcb_trace_id: "d-second-unchanged" })
  input.pointPairs = structuredClone(input.originalSrj)
  return input
}
