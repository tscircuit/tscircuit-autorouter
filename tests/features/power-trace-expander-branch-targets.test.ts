import { expect, test } from "bun:test"
import {
  PowerTraceExpanderSolver,
  type PowerTraceExpanderInput,
} from "@tscircuit/power-trace-expander"
import { getSvgFromGraphicsObject } from "graphics-debug"

test("the pinned expander widens only clear branch targets at the search limit", async () => {
  const wire = (x: number, y: number, width = 0.15) => ({
    route_type: "wire" as const,
    x,
    y,
    layer: "top",
    width,
  })
  const boardOutline = [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 },
    { x: 6, y: 5 }, { x: 6, y: 3 }, { x: 4, y: 3 },
    { x: 4, y: 5 }, { x: 0, y: 5 },
  ]
  const traces: PowerTraceExpanderInput["traces"] = [
    {
      type: "pcb_trace", pcb_trace_id: "supply", connection_name: "shared",
      nominalTraceWidth: 0.8, route: [wire(1, 1), wire(5, 1)],
    },
    {
      type: "pcb_trace", pcb_trace_id: "sense", connection_name: "shared",
      nominalTraceWidth: 0.15, route: [wire(5, 1), wire(9, 1)],
    },
    {
      type: "pcb_trace", pcb_trace_id: "at-notch", connection_name: "edge",
      nominalTraceWidth: 0.8, route: [wire(1, 2.6), wire(9, 2.6)],
    },
  ]
  const solver = new PowerTraceExpanderSolver(
    {
      layerCount: 2,
      minTraceWidth: 0.15,
      minBoardEdgeClearance: 0.2,
      bounds: { minX: 0, maxX: 10, minY: 0, maxY: 5 },
      boardOutline,
      obstacles: [],
      connections: [
        {
          name: "shared",
          nominalTraceWidth: 0.15,
          pointsToConnect: [wire(1, 1), wire(5, 1), wire(9, 1)],
        },
        {
          name: "edge",
          nominalTraceWidth: 0.15,
          pointsToConnect: [wire(1, 2.6), wire(9, 2.6)],
        },
      ],
      traces,
    },
    { widenInPlaceAtSearchLimit: true },
  )
  solver.iterations = Number(solver.stats.expansionIterationBudget)
  solver.solve()

  expect(solver.solved, solver.error ?? "").toBe(true)
  expect(solver.stats.completionReason).toBe("expansion_budget")
  const [supply, sense, atNotch] = solver.getOutput()
  expect(supply.route).toEqual([wire(1, 1, 0.8), wire(5, 1, 0.8)])
  expect(sense.route).toEqual([wire(5, 1), wire(9, 1)])
  expect(atNotch.route).toEqual([wire(1, 2.6), wire(9, 2.6)])

  const graphics = solver.visualize()
  const svg = getSvgFromGraphicsObject(
    {
      ...graphics,
      lines: [
        { points: [...boardOutline, boardOutline[0]], strokeColor: "#475569", strokeWidth: 0.04 },
        ...graphics.lines!,
      ],
    },
    { backgroundColor: "white", svgWidth: 800, svgHeight: 430 },
  )
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
