// ============================================================
// FILE: tests/trace-thickness.test.ts  (NEW FILE)
// Tests for issue #66 — trace thickness as a parameter
// ============================================================

import { expect, test, describe } from "bun:test"
import { AutoroutingPipelineSolver } from "../lib"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "../lib/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a minimal 2-layer board with two pads and one connection. */
function makeTwoPointBoard(
  overrides: Partial<SimpleRouteJson> = {},
): SimpleRouteJson {
  return {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    obstacles: [],
    connections: [
      {
        name: "net1",
        pointsToConnect: [
          { x: -5, y: 0, layer: "top" },
          { x: 5, y: 0, layer: "top" },
        ],
      },
    ],
    ...overrides,
  }
}

function solveAndGetTraces(srj: SimpleRouteJson): SimplifiedPcbTrace[] {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const output = solver.getOutputSimpleRouteJson()
  return (output.traces ?? []) as SimplifiedPcbTrace[]
}

/** Returns all wire widths in all traces. */
function getWireWidths(traces: SimplifiedPcbTrace[]): number[] {
  return traces.flatMap((t) =>
    t.route
      .filter((seg) => seg.route_type === "wire")
      .map((seg) => (seg as any).width as number),
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("trace thickness — default behaviour", () => {
  test("default trace uses minTraceWidth when no width is specified", () => {
    const traces = solveAndGetTraces(makeTwoPointBoard())
    const widths = getWireWidths(traces)
    expect(widths.length).toBeGreaterThan(0)
    for (const w of widths) {
      expect(w).toBeCloseTo(0.15, 2)
    }
  })
})

describe("trace thickness — nominalTraceWidth (existing API)", () => {
  test("connection with nominalTraceWidth=0.3 produces 0.3mm traces (2× min)", () => {
    const srj = makeTwoPointBoard({
      connections: [
        {
          name: "power",
          nominalTraceWidth: 0.3,
          pointsToConnect: [
            { x: -5, y: 0, layer: "top" },
            { x: 5, y: 0, layer: "top" },
          ],
        },
      ],
    })
    const traces = solveAndGetTraces(srj)
    const widths = getWireWidths(traces)
    expect(widths.length).toBeGreaterThan(0)
    // At least one segment should be at or near 0.3mm
    const hasThickTrace = widths.some((w) => w >= 0.28)
    expect(hasThickTrace).toBe(true)
  })
})

describe("trace thickness — traceWidthMultiplier (new API)", () => {
  test("multiplier=2 produces traces ≥ 2× minTraceWidth", () => {
    const srj = makeTwoPointBoard({
      connections: [
        {
          name: "VCC",
          traceWidthMultiplier: 2,
          pointsToConnect: [
            { x: -5, y: 0, layer: "top" },
            { x: 5, y: 0, layer: "top" },
          ],
        },
      ],
    })
    const traces = solveAndGetTraces(srj)
    const widths = getWireWidths(traces)
    expect(widths.length).toBeGreaterThan(0)
    const expectedMin = 0.15 * 2 * 0.9 // allow 10% tolerance for fallback
    const hasThick = widths.some((w) => w >= expectedMin)
    expect(hasThick).toBe(true)
  })

  test("multiplier=4 produces traces ≥ 4× minTraceWidth when space allows", () => {
    // Wide open board — plenty of room for a 0.6mm trace
    const srj = makeTwoPointBoard({
      bounds: { minX: -50, maxX: 50, minY: -50, maxY: 50 },
      connections: [
        {
          name: "VMOT",
          traceWidthMultiplier: 4,
          pointsToConnect: [
            { x: -20, y: 0, layer: "top" },
            { x: 20, y: 0, layer: "top" },
          ],
        },
      ],
    })
    const traces = solveAndGetTraces(srj)
    const widths = getWireWidths(traces)
    expect(widths.length).toBeGreaterThan(0)
    const expectedMin = 0.15 * 4 * 0.9
    const hasThick = widths.some((w) => w >= expectedMin)
    expect(hasThick).toBe(true)
  })

  test("multiplier=8 falls back gracefully when traces are cramped", () => {
    // Dense board — lots of obstacles mean 8x probably can't fit; must not fail
    const obstacles = Array.from({ length: 8 }, (_, i) => ({
      type: "rect" as const,
      layers: ["top"],
      center: { x: -3 + i, y: 0.5 },
      width: 0.4,
      height: 2,
      connectedTo: [],
    }))

    const srj = makeTwoPointBoard({
      obstacles,
      connections: [
        {
          name: "GND",
          traceWidthMultiplier: 8,
          pointsToConnect: [
            { x: -5, y: 0, layer: "top" },
            { x: 5, y: 0, layer: "top" },
          ],
        },
      ],
    })
    const solver = new AutoroutingPipelineSolver(srj)
    solver.solve()
    // Should not fail even when the requested width can't fit
    expect(solver.failed).toBe(false)
  })

  test("mixed connections: power trace is thicker than signal trace", () => {
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.15,
      bounds: { minX: -20, maxX: 20, minY: -20, maxY: 20 },
      obstacles: [],
      connections: [
        {
          name: "VCC",
          traceWidthMultiplier: 4, // power → 0.6mm
          pointsToConnect: [
            { x: -8, y: 5, layer: "top" },
            { x: 8, y: 5, layer: "top" },
          ],
        },
        {
          name: "DATA",
          // no width spec → should use minTraceWidth
          pointsToConnect: [
            { x: -8, y: -5, layer: "top" },
            { x: 8, y: -5, layer: "top" },
          ],
        },
      ],
    }

    const traces = solveAndGetTraces(srj)
    expect(traces.length).toBeGreaterThanOrEqual(2)

    const vccTrace = traces.find((t) => t.connection_name === "VCC")
    const dataTrace = traces.find((t) => t.connection_name === "DATA")

    expect(vccTrace).toBeDefined()
    expect(dataTrace).toBeDefined()

    const vccWidths = getWireWidths([vccTrace!])
    const dataWidths = getWireWidths([dataTrace!])

    expect(vccWidths.length).toBeGreaterThan(0)
    expect(dataWidths.length).toBeGreaterThan(0)

    const maxVcc = Math.max(...vccWidths)
    const maxData = Math.max(...dataWidths)

    // Power trace must be thicker than signal trace
    expect(maxVcc).toBeGreaterThan(maxData)
  })
})

describe("trace thickness — traceWidthMultiplier type safety", () => {
  test("TypeScript interface accepts valid multipliers: 1, 2, 4, 8", () => {
    const validConnections = [1, 2, 4, 8].map((m) => ({
      name: `net${m}`,
      traceWidthMultiplier: m as 1 | 2 | 4 | 8,
      pointsToConnect: [
        { x: -5, y: 0, layer: "top" },
        { x: 5, y: 0, layer: "top" },
      ],
    }))
    // Type-level check — if this compiles, the interface is correct
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.15,
      bounds: { minX: -20, maxX: 20, minY: -20, maxY: 20 },
      obstacles: [],
      connections: [validConnections[0]!], // just test one at runtime
    }
    const solver = new AutoroutingPipelineSolver(srj)
    solver.solve()
    expect(solver.failed).toBe(false)
  })
})

describe("trace thickness — nominalTraceWidth takes priority over multiplier", () => {
  test("when both are set, nominalTraceWidth wins", () => {
    const srj = makeTwoPointBoard({
      connections: [
        {
          name: "PWR",
          nominalTraceWidth: 0.45, // explicit absolute
          traceWidthMultiplier: 2, // would give 0.30 — should be ignored
          pointsToConnect: [
            { x: -5, y: 0, layer: "top" },
            { x: 5, y: 0, layer: "top" },
          ],
        },
      ],
    })
    const traces = solveAndGetTraces(srj)
    const widths = getWireWidths(traces)
    const hasNominalWidth = widths.some((w) => w >= 0.42)
    expect(hasNominalWidth).toBe(true)
  })
})

describe("trace thickness — edge cases", () => {
  test("multiplier=1 behaves the same as no multiplier (uses minTraceWidth)", () => {
    const withMultiplier = makeTwoPointBoard({
      connections: [
        {
          name: "sig",
          traceWidthMultiplier: 1,
          pointsToConnect: [
            { x: -5, y: 0, layer: "top" },
            { x: 5, y: 0, layer: "top" },
          ],
        },
      ],
    })
    const withoutMultiplier = makeTwoPointBoard()

    const widths1 = getWireWidths(solveAndGetTraces(withMultiplier))
    const widths2 = getWireWidths(solveAndGetTraces(withoutMultiplier))

    // Both should be at minTraceWidth
    for (const w of widths1) expect(w).toBeCloseTo(0.15, 2)
    for (const w of widths2) expect(w).toBeCloseTo(0.15, 2)
  })

  test("board with nominalTraceWidth set globally applies it to connections that request it explicitly", () => {
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.15,
      nominalTraceWidth: 0.25,
      bounds: { minX: -20, maxX: 20, minY: -20, maxY: 20 },
      obstacles: [],
      connections: [
        {
          name: "SIG",
          nominalTraceWidth: 0.25, // explicit request matching board default
          pointsToConnect: [
            { x: -5, y: 0, layer: "top" },
            { x: 5, y: 0, layer: "top" },
          ],
        },
      ],
    }
    const traces = solveAndGetTraces(srj)
    const widths = getWireWidths(traces)
    const hasNominalWidth = widths.some((w) => w >= 0.23)
    expect(hasNominalWidth).toBe(true)
  })
})
