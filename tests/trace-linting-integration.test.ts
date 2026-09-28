import { expect, test } from "bun:test"
import { runTraceLinting } from "../lib/testing/runTraceLinting"
import type { SimpleRouteJson } from "../lib/types/srj-types"

test("trace linting solves the final SRJ and locates wire/via issues without changing routing", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.2,
    bounds: { minX: -1, maxX: 6, minY: -1, maxY: 6 },
    obstacles: [],
    connections: [],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "trace1",
        connection_name: "net1",
        route: [
          { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.2 },
          { route_type: "wire", x: 2, y: 1, layer: "top", width: 0.2 },
          {
            route_type: "via",
            x: 2,
            y: 1,
            from_layer: "top",
            to_layer: "bottom",
          },
          { route_type: "wire", x: 4, y: 2, layer: "bottom", width: 0.2 },
          { route_type: "wire", x: 5, y: 3, layer: "bottom", width: 0.2 },
        ],
      },
    ],
  }
  const original = structuredClone(srj)
  const linter = runTraceLinting(srj)
  expect(linter.solved).toBe(true)
  expect(
    linter.getOutput().map((issue) => [issue.segmentIndex, issue.layer]),
  ).toEqual([
    [0, "top"],
    [2, "bottom"],
  ])
  expect(linter.finalVisualize().points).toHaveLength(2)
  expect(srj).toEqual(original)
  expect(runTraceLinting({ ...srj, traces: [] }).getOutput()).toEqual([])
  expect(() =>
    runTraceLinting({ ...srj, bounds: { ...srj.bounds, minX: NaN } }),
  ).toThrow()
})
