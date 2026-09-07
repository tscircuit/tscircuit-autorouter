import { expect, test } from "bun:test"
import { checkPadTraceClearance } from "@tscircuit/checks"
import { pointToSegmentClosestPoint } from "@tscircuit/math-utils"
import type { AnyCircuitElement } from "circuit-json"
import { getPipeline9HighDensityForceObstacles } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceObstacles"
import { getPipeline9PadCopperForceTarget } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PadCopperForceTarget"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 pad witnesses match official physical shapes and layer spans", (): void => {
  const cases: Array<{
    pad: Record<string, unknown>
    traceY: number
    copperY: number
  }> = [
    {
      pad: {
        type: "pcb_smtpad",
        pcb_smtpad_id: "target",
        shape: "rotated_rect",
        x: 0,
        y: 0,
        width: 0.4,
        height: 2,
        ccw_rotation: 90,
        layer: "top",
      },
      traceY: 0.3,
      copperY: 0.2,
    },
    {
      pad: {
        type: "pcb_plated_hole",
        pcb_plated_hole_id: "target",
        shape: "circle",
        x: 0,
        y: 0,
        outer_diameter: 2,
        hole_diameter: 0.5,
        layers: ["top", "bottom"],
      },
      traceY: 1.1,
      copperY: 1,
    },
    {
      pad: {
        type: "pcb_plated_hole",
        pcb_plated_hole_id: "target",
        shape: "circular_hole_with_rect_pad",
        x: 0,
        y: 0,
        rect_pad_width: 2,
        rect_pad_height: 0.4,
        hole_diameter: 0.2,
        layers: ["top", "bottom"],
      },
      traceY: 0.3,
      copperY: 0.2,
    },
    {
      pad: {
        type: "pcb_plated_hole",
        pcb_plated_hole_id: "target",
        shape: "rotated_pill_hole_with_rect_pad",
        x: 0,
        y: 0,
        rect_pad_width: 2,
        rect_pad_height: 0.4,
        rect_ccw_rotation: 90,
        hole_width: 0.4,
        hole_height: 0.2,
        hole_ccw_rotation: 90,
        layers: ["top", "bottom"],
      },
      traceY: 1.1,
      copperY: 1,
    },
  ]
  for (const { pad, traceY, copperY } of cases) {
    const route: HighDensityRoute = {
      connectionName: "wire",
      rootConnectionName: "wire",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -0.5, y: traceY, z: 0 },
        { x: 0.5, y: traceY, z: 0 },
      ],
      vias: [],
    }
    const circuitJson = [
      pad,
      {
        type: "pcb_trace",
        pcb_trace_id: "wire",
        route: route.route.map((point) => ({
          route_type: "wire",
          x: point.x,
          y: point.y,
          layer: "top",
          width: 0.1,
        })),
      },
    ] as unknown as AnyCircuitElement[]
    const errors = checkPadTraceClearance(circuitJson, { minClearance: 0.1 })
    expect(errors).toHaveLength(1)
    const actualClearance = errors[0]!.actual_clearance
    if (typeof actualClearance !== "number") {
      throw new Error("Expected an official pad clearance measurement")
    }
    const projections = getPipeline9HighDensityForceObstacles({
      circuitJson,
      bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
      layerCount: 2,
      minTraceWidth: 0.1,
    })
    const obstacles = [
      ...projections.map((obstacle) => ({
        ...obstacle,
        connectedTo: ["coincident-other-pad"],
      })),
      ...projections,
    ]
    const original = structuredClone({ pad, route, obstacles, errors })
    const target = getPipeline9PadCopperForceTarget({
      pad,
      route,
      obstacles,
      layerCount: 2,
    })
    expect(target).toBeDefined()
    expect(target!.segmentIndex).toBe(0)
    expect(target!.center.y).toBeCloseTo(copperY, 12)
    const closest = pointToSegmentClosestPoint(
      target!.center,
      route.route[0]!,
      route.route[1]!,
    )
    const witnessGap =
      Math.hypot(closest.x - target!.center.x, closest.y - target!.center.y) -
      route.traceThickness / 2
    expect(witnessGap).toBeCloseTo(actualClearance, 12)
    expect(target!.tracePoint.x).toBeCloseTo(closest.x, 12)
    expect(target!.tracePoint.y).toBeCloseTo(closest.y, 12)
    expect(target!.distance - route.traceThickness / 2).toBeCloseTo(
      actualClearance,
      12,
    )
    expect(
      target!.obstacles.every(
        (obstacle) =>
          obstacle.connectedTo.length === 1 &&
          obstacle.connectedTo[0] === "target",
      ),
    ).toBe(true)
    if (pad.type === "pcb_smtpad") {
      expect(
        getPipeline9PadCopperForceTarget({
          pad,
          route: {
            ...route,
            route: route.route.map((point) => ({ ...point, z: 1 })),
          },
          obstacles,
          layerCount: 2,
        }),
      ).toBeUndefined()
    }
    expect({ pad, route, obstacles, errors }).toEqual(original)
  }
})
