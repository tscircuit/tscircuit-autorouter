import { expect, test } from "bun:test"
import { relativeWitnessRepairFixture, proveRelativeFixture } from "./relativeWitnessRepairFixture"

test("a same-owner branch near a moving segment cannot be assumed preserved from graph reason counts", () => {
  const input = relativeWitnessRepairFixture()
  for (const point of input.traces[2]!.route) if (point.route_type === "wire") point.width = 0.01
  input.traces.push({ type: "pcb_trace", pcb_trace_id: "d-branch", connection_name: "D", route: [
    { route_type: "wire", x: -2.15, y: -3.1, layer: "top", width: 0.01 },
    { route_type: "wire", x: -2.15, y: -3.009, layer: "top", width: 0.01 },
  ] })
  expect(proveRelativeFixture(input).status).toBe("UNKNOWN")
})
