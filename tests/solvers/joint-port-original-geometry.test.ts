import { expect, test } from "bun:test"
import { optimizeJointPortCoordinates } from "lib/solvers/UniformPortDistributionSolver/optimizeJointPortCoordinates"
import { createJointPortTestInput } from "./joint-port-test-input"

test("original pads fixed copper and concave outline prevent unsafe corridor optimization", (): void => {
  const cases = Array.from({ length: 6 }, () => createJointPortTestInput())
  cases[0].srj.obstacles.push({ type: "rect", shape: "circle", center: { x: 0, y: 0 },
    width: 0.5, height: 0.5, connectedTo: [], layers: ["bottom"] })
  cases[1].srj.obstacles.push({ type: "rect", center: { x: 2, y: 0.5 },
    width: 0.1, height: 2, ccwRotationDegrees: 90, connectedTo: [], layers: ["top"] })
  cases[2].srj.traces = [{ type: "pcb_trace", pcb_trace_id: "fixed", connection_name: "fixed",
    route: [{ route_type: "wire", x: 1, y: -1, width: 0.2, layer: "top" },
      { route_type: "wire", x: 1, y: 1, width: 0.2, layer: "top" }] }]
  cases[3].srj.outline = [{ x: -10, y: -10 }, { x: 10, y: -10 },
    { x: 10, y: 10 }, { x: 2, y: 10 }, { x: 2, y: 0.2 },
    { x: 1, y: 0.2 }, { x: 1, y: 10 }, { x: -10, y: 10 }]
  cases[4].srj.bounds.maxX = 4.02
  cases[5].srj.traces = [{ type: "pcb_trace", pcb_trace_id: "jumper", connection_name: "fixed",
    route: [{ route_type: "jumper", start: { x: 8, y: 8 }, end: { x: 9, y: 8 },
      footprint: "0603", layer: "top" }] }]
  for (const input of cases) {
    const result = optimizeJointPortCoordinates(input)
    expect(result.stats.movedPortCount).toBe(0)
    expect(result.nodes).toEqual(input.nodes)
  }
  expect(optimizeJointPortCoordinates(cases[5]).stats.unsupportedGeometry).toBeTrue()
})
