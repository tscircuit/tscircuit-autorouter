import { describe, test, expect } from "bun:test"
import { CapacityMeshAutorouterCoreBinding } from "./fixtures/CapacityMeshAutorouterCoreBinding"
import type { SimpleRouteJson } from "../lib/types"
import {
  getTraceThicknessFromConnection,
  getViaDiameterFromConnection,
  validateTraceThicknessParameters,
  STANDARD_TRACE_THICKNESS,
  STANDARD_VIA_DIAMETER,
  COMMON_TRACE_MULTIPLIERS,
} from "../lib/utils/getTraceThicknessFromConnection"

describe("Trace Thickness Functionality", () => {
  describe("Utility Functions", () => {
    test("getTraceThicknessFromConnection - explicit thickness", () => {
      const connection = {
        name: "test",
        pointsToConnect: [],
        traceThickness: 0.3,
      }

      expect(getTraceThicknessFromConnection(connection)).toBe(0.3)
    })

    test("getTraceThicknessFromConnection - multiplier", () => {
      const connection = {
        name: "test",
        pointsToConnect: [],
        traceThicknessMultiplier: 2,
      }

      expect(getTraceThicknessFromConnection(connection)).toBe(0.3) // 2 * 0.15
    })

    test("getTraceThicknessFromConnection - default", () => {
      const connection = {
        name: "test",
        pointsToConnect: [],
      }

      expect(getTraceThicknessFromConnection(connection)).toBe(
        STANDARD_TRACE_THICKNESS,
      )
    })

    test("getViaDiameterFromConnection", () => {
      const connection1 = {
        name: "test",
        pointsToConnect: [],
        viaDiameter: 0.8,
      }

      const connection2 = {
        name: "test",
        pointsToConnect: [],
      }

      expect(getViaDiameterFromConnection(connection1)).toBe(0.8)
      expect(getViaDiameterFromConnection(connection2)).toBe(
        STANDARD_VIA_DIAMETER,
      )
    })

    test("validateTraceThicknessParameters - valid", () => {
      const connection = {
        name: "test",
        pointsToConnect: [],
        traceThickness: 0.3,
      }

      expect(validateTraceThicknessParameters(connection)).toEqual([])
    })

    test("validateTraceThicknessParameters - conflicting parameters", () => {
      const connection = {
        name: "test",
        pointsToConnect: [],
        traceThickness: 0.3,
        traceThicknessMultiplier: 2,
      }

      const errors = validateTraceThicknessParameters(connection)
      expect(errors.length).toBe(1)
      expect(errors[0]).toContain(
        "both traceThickness and traceThicknessMultiplier",
      )
    })

    test("validateTraceThicknessParameters - invalid thickness", () => {
      const connection = {
        name: "test",
        pointsToConnect: [],
        traceThickness: -0.1,
      }

      const errors = validateTraceThicknessParameters(connection)
      expect(errors.length).toBe(1)
      expect(errors[0]).toContain("Must be positive")
    })
  })

  describe("Common Trace Multipliers", () => {
    test("standard multipliers are correct", () => {
      expect(COMMON_TRACE_MULTIPLIERS[1]).toBe(0.15)
      expect(COMMON_TRACE_MULTIPLIERS[2]).toBe(0.3)
      expect(COMMON_TRACE_MULTIPLIERS[4]).toBe(0.6)
      expect(COMMON_TRACE_MULTIPLIERS[8]).toBe(1.2)
    })
  })

  describe("End-to-End Routing with Different Trace Thicknesses", () => {
    test("routes with different trace thicknesses", async () => {
      const simpleRouteJson: SimpleRouteJson = {
        layerCount: 2,
        minTraceWidth: 0.1,
        obstacles: [
          {
            type: "rect",
            layers: ["top"],
            center: { x: 0, y: 0 },
            width: 1,
            height: 1,
            connectedTo: [],
          },
        ],
        connections: [
          {
            name: "signal_trace",
            pointsToConnect: [
              { x: -5, y: 0, layer: "top" },
              { x: 5, y: 0, layer: "top" },
            ],
            traceThickness: 0.15, // Standard signal trace
          },
          {
            name: "power_trace",
            pointsToConnect: [
              { x: -5, y: 2, layer: "top" },
              { x: 5, y: 2, layer: "top" },
            ],
            traceThicknessMultiplier: 4, // 4x thicker for power (0.6mm)
          },
          {
            name: "high_power_trace",
            pointsToConnect: [
              { x: -5, y: -2, layer: "top" },
              { x: 5, y: -2, layer: "top" },
            ],
            traceThickness: 1.2, // Explicit thick trace for high power
          },
        ],
        bounds: { minX: -10, maxX: 10, minY: -5, maxY: 5 },
      }

      const solver = new CapacityMeshAutorouterCoreBinding(simpleRouteJson)
      const traces = solver.solveSync()

      expect(traces).toBeDefined()
      expect(traces.length).toBe(3)

      // Check that each trace has the correct width
      const signalTrace = traces.find((t) =>
        t.pcb_trace_id?.includes("signal_trace"),
      )
      const powerTrace = traces.find((t) => t.pcb_trace_id === "power_trace_0")
      const highPowerTrace = traces.find(
        (t) => t.pcb_trace_id === "high_power_trace_0",
      )

      expect(signalTrace).toBeDefined()
      expect(powerTrace).toBeDefined()
      expect(highPowerTrace).toBeDefined()

      // Check wire widths in the routes
      const signalWires = signalTrace!.route.filter(
        (r: any) => r.route_type === "wire",
      )
      const powerWires = powerTrace!.route.filter(
        (r: any) => r.route_type === "wire",
      )
      const highPowerWires = highPowerTrace!.route.filter(
        (r: any) => r.route_type === "wire",
      )

      expect(signalWires.every((w: any) => w.width === 0.15)).toBe(true)
      expect(powerWires.every((w: any) => w.width === 0.6)).toBe(true)
      expect(highPowerWires.every((w: any) => w.width === 1.2)).toBe(true)
    })

    test("routes with custom via diameters", async () => {
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
            name: "thick_trace_with_large_via",
            pointsToConnect: [
              { x: -3, y: 0, layer: "top" },
              { x: 3, y: 0, layer: "bottom" }, // Force a via
            ],
            traceThickness: 0.6,
            viaDiameter: 1.0, // Large via for thick trace
          },
        ],
        bounds: { minX: -5, maxX: 5, minY: -3, maxY: 3 },
      }

      const solver = new CapacityMeshAutorouterCoreBinding(simpleRouteJson)
      const traces = solver.solveSync()

      expect(traces).toBeDefined()
      expect(traces.length).toBe(1)

      const trace = traces[0]
      const wires = trace.route.filter((r: any) => r.route_type === "wire")
      const vias = trace.route.filter((r: any) => r.route_type === "via")

      // Check that wires have correct thickness
      expect(wires.every((w: any) => w.width === 0.6)).toBe(true)

      // Check that vias are present (layer change should create vias)
      expect(vias.length).toBeGreaterThan(0)
    })
  })
})
