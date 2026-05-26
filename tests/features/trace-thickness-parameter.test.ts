import { test, expect } from "bun:test"
import { CapacityMeshSolver } from "lib/index"
import type { SimpleRouteJson } from "lib/types"

/**
 * e2e test for issue #66: trace thickness as a parameter.
 *
 * Verifies that:
 * 1. Per-connection `nominalTraceWidth` is respected: fat traces are wider
 *    than thin traces in the output.
 * 2. The global SRJ `nominalTraceWidth` is applied to connections that don't
 *    specify one explicitly.
 * 3. All output traces have `width >= minTraceWidth`.
 */

const makeSrj = (overrides?: Partial<SimpleRouteJson>): SimpleRouteJson => ({
  layerCount: 2,
  minTraceWidth: 0.1,
  bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
  obstacles: [],
  connections: [
    {
      name: "fat_net",
      nominalTraceWidth: 0.5, // explicitly wide
      pointsToConnect: [
        { x: -8, y: 0, layer: "top" },
        { x: 8, y: 0, layer: "top" },
      ],
    },
    {
      name: "thin_net",
      nominalTraceWidth: 0.15, // explicitly narrow
      pointsToConnect: [
        { x: -8, y: 4, layer: "top" },
        { x: 8, y: 4, layer: "top" },
      ],
    },
  ],
  ...overrides,
})

test("trace thickness: per-connection nominalTraceWidth is respected in output", () => {
  const srj = makeSrj()
  const solver = new CapacityMeshSolver(srj)
  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)

  const output = solver.getOutputSimpleRouteJson()
  expect(output.traces).toBeDefined()
  expect(output.traces!.length).toBeGreaterThan(0)

  const widthByNet = new Map<string, number>()
  for (const trace of output.traces!) {
    const netName = trace.connection_name
    for (const point of trace.route) {
      if ("width" in point && typeof point.width === "number") {
        const current = widthByNet.get(netName) ?? 0
        if (point.width > current) widthByNet.set(netName, point.width)
      }
    }
  }

  const fatWidth = widthByNet.get("fat_net")
  const thinWidth = widthByNet.get("thin_net")

  expect(fatWidth).toBeDefined()
  expect(thinWidth).toBeDefined()
  expect(fatWidth!).toBeGreaterThan(thinWidth!)

  for (const [, w] of widthByNet) {
    expect(w).toBeGreaterThanOrEqual(srj.minTraceWidth)
  }
}, 30_000)

test("trace thickness: global nominalTraceWidth applied to connections without per-connection override", () => {
  const nominalTraceWidth = 0.4
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    nominalTraceWidth,
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    obstacles: [],
    connections: [
      {
        name: "net_a",
        pointsToConnect: [
          { x: -8, y: 2, layer: "top" },
          { x: 8, y: 2, layer: "top" },
        ],
      },
      {
        name: "net_b",
        nominalTraceWidth: 0.15,
        pointsToConnect: [
          { x: -8, y: -2, layer: "top" },
          { x: 8, y: -2, layer: "top" },
        ],
      },
    ],
  }

  const solver = new CapacityMeshSolver(srj)
  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)

  const output = solver.getOutputSimpleRouteJson()
  expect(output.traces).toBeDefined()

  const widthByNet = new Map<string, number>()
  for (const trace of output.traces!) {
    const netName = trace.connection_name
    for (const point of trace.route) {
      if ("width" in point && typeof point.width === "number") {
        const current = widthByNet.get(netName) ?? 0
        if (point.width > current) widthByNet.set(netName, point.width)
      }
    }
  }

  const widthA = widthByNet.get("net_a")
  const widthB = widthByNet.get("net_b")

  expect(widthA).toBeDefined()
  expect(widthB).toBeDefined()
  expect(widthA!).toBeGreaterThan(widthB!)
}, 30_000)

