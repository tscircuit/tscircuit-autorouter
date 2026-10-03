import { expect, test } from "bun:test"
import { createDynamicNetTreeProblem } from "lib/solvers/DynamicNetTreeSolver/createDynamicNetTreeProblem"
import type { SimpleRouteJson } from "lib/types"
test("adapter rejects conflicting pad IDs and unresolved fixed-copper owners", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.2,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections: [
      {
        name: "N",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pointId: "shared" },
          { x: 2, y: 0, layer: "top" },
        ],
      },
      {
        name: "N_2",
        pointsToConnect: [{ x: 3, y: 0, layer: "top", pointId: "shared" }],
      },
    ],
  }
  expect(() => createDynamicNetTreeProblem(srj, "N", [], new Map())).toThrow(
    "Conflicting explicit owner",
  )
  srj.connections.pop()
  expect(() =>
    createDynamicNetTreeProblem(
      srj,
      "N",
      [
        {
          type: "pcb_trace",
          pcb_trace_id: "fixed",
          connection_name: "N_mst",
          route: [],
        },
      ],
      new Map(),
    ),
  ).toThrow("explicit valid owner")
})
