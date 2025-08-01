import { describe, test, expect } from "bun:test"
import { CapacityMeshAutorouterCoreBinding } from "./fixtures/CapacityMeshAutorouterCoreBinding"
import type { SimpleRouteJson } from "../lib/types"

describe("Basic Trace Thickness Tests", () => {
  test("simple route with explicit trace thickness", async () => {
    const simpleRouteJson: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.1,
      obstacles: [
        {
          type: "rect",
          layers: ["top"],
          center: { x: 0, y: 1 },
          width: 1,
          height: 1,
          connectedTo: [],
        },
      ],
      connections: [
        {
          name: "thick_trace",
          pointsToConnect: [
            { x: -3, y: 0, layer: "top" },
            { x: 3, y: 0, layer: "top" },
          ],
          traceThickness: 0.6, // 4x standard thickness
        },
      ],
      bounds: { minX: -5, maxX: 5, minY: -2, maxY: 2 },
    }

    const solver = new CapacityMeshAutorouterCoreBinding(simpleRouteJson)
    const traces = solver.solveSync()

    expect(traces).toBeDefined()
    expect(traces.length).toBe(1)

    const trace = traces[0]
    expect(trace.pcb_trace_id).toContain("thick_trace")

    // Check that all wire segments have the correct width
    const wires = trace.route.filter((r: any) => r.route_type === "wire")
    expect(wires.length).toBeGreaterThan(0)

    // Debug: log the actual widths
    console.log(
      "Wire widths (thick_trace):",
      wires.map((w: any) => w.width),
    )

    expect(wires.every((w: any) => w.width === 0.6)).toBe(true)
  })

  test("simple route with trace thickness multiplier", async () => {
    const simpleRouteJson: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.1,
      obstacles: [
        {
          type: "rect",
          layers: ["top"],
          center: { x: 0, y: 1 },
          width: 1,
          height: 1,
          connectedTo: [],
        },
      ],
      connections: [
        {
          name: "power_trace",
          pointsToConnect: [
            { x: -3, y: 0, layer: "top" },
            { x: 3, y: 0, layer: "top" },
          ],
          traceThicknessMultiplier: 2, // 2x standard = 0.3mm
        },
      ],
      bounds: { minX: -5, maxX: 5, minY: -2, maxY: 2 },
    }

    const solver = new CapacityMeshAutorouterCoreBinding(simpleRouteJson)
    const traces = solver.solveSync()

    expect(traces).toBeDefined()
    expect(traces.length).toBe(1)

    const trace = traces[0]
    const wires = trace.route.filter((r: any) => r.route_type === "wire")

    // Debug: log the actual widths
    console.log(
      "Wire widths:",
      wires.map((w: any) => w.width),
    )

    expect(wires.every((w: any) => w.width === 0.3)).toBe(true) // 2 * 0.15 = 0.3
  })

  test("route with default trace thickness", async () => {
    const simpleRouteJson: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.1,
      obstacles: [
        {
          type: "rect",
          layers: ["top"],
          center: { x: 0, y: 1 },
          width: 1,
          height: 1,
          connectedTo: [],
        },
      ],
      connections: [
        {
          name: "default_trace",
          pointsToConnect: [
            { x: -3, y: 0, layer: "top" },
            { x: 3, y: 0, layer: "top" },
          ],
          // No trace thickness specified - should use default 0.15mm
        },
      ],
      bounds: { minX: -5, maxX: 5, minY: -2, maxY: 2 },
    }

    const solver = new CapacityMeshAutorouterCoreBinding(simpleRouteJson)
    const traces = solver.solveSync()

    expect(traces).toBeDefined()
    expect(traces.length).toBe(1)

    const trace = traces[0]
    const wires = trace.route.filter((r: any) => r.route_type === "wire")
    expect(wires.every((w: any) => w.width === 0.15)).toBe(true) // Default thickness
  })
})
