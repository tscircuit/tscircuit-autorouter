import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbTrace, PcbVia } from "circuit-json"
import { applyPipeline9PadTraceDetour } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9PadTraceDetour"
import { getPipeline9HighDensityForceObstacles } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceObstacles"
import { getPipeline9PadCopperForceTarget } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PadCopperForceTarget"
import { getDrcErrors, type GetDrcErrorsResult } from "lib/testing/getDrcErrors"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("physical pad detours clear official copper checks while retaining fixed segment anchors", (): void => {
  const pads: Record<string, unknown>[] = [
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "target",
      shape: "rect",
      width: 0.4,
      height: 0.4,
      layer: "top",
      x: 0,
      y: 0,
    },
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "target",
      shape: "rotated_rect",
      width: 0.8,
      height: 0.2,
      ccw_rotation: 31,
      layer: "top",
      x: 0,
      y: 0,
    },
    {
      type: "pcb_plated_hole",
      pcb_plated_hole_id: "target",
      shape: "circle",
      outer_diameter: 0.5,
      hole_diameter: 0.2,
      layers: ["top", "bottom"],
      x: 0,
      y: 0,
    },
    {
      type: "pcb_plated_hole",
      pcb_plated_hole_id: "target",
      shape: "circular_hole_with_rect_pad",
      rect_pad_width: 0.7,
      rect_pad_height: 0.3,
      hole_diameter: 0.2,
      layers: ["top", "bottom"],
      x: 0,
      y: 0,
    },
    {
      type: "pcb_plated_hole",
      pcb_plated_hole_id: "target",
      shape: "rotated_pill_hole_with_rect_pad",
      rect_pad_width: 0.7,
      rect_pad_height: 0.3,
      rect_ccw_rotation: 53,
      hole_width: 0.3,
      hole_height: 0.1,
      hole_ccw_rotation: 53,
      layers: ["top", "bottom"],
      x: 0,
      y: 0,
    },
  ]
  const bounds = { minX: -3, maxX: 3, minY: -3, maxY: 3 }
  const fixedVia: PcbVia = {
    type: "pcb_via",
    pcb_via_id: "fixed-via",
    x: 0,
    y: 2,
    outer_diameter: 0.3,
    hole_diameter: 0.15,
    layers: ["top", "bottom"],
  }
  for (const [padIndex, pad] of pads.entries()) {
    // Cover both a non-contact clearance and paths through actual copper. This
    // proves the insertion geometry, not the outcome of another force family.
    const route: HighDensityRoute = {
      connectionName: "A_0",
      rootConnectionName: "A_0",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -2, y: padIndex === 0 ? 0.27 : -0.5, z: 0 },
        { x: 2, y: padIndex === 0 ? 0.27 : 0.5, z: 0 },
      ],
      vias: [],
    }
    if (padIndex > 0) route.route[0]!.traceThickness = 0.2
    route.route[1]!.traceThickness = 0.07
    const evaluate = (candidate: HighDensityRoute): GetDrcErrorsResult => {
      const trace: PcbTrace = {
        type: "pcb_trace",
        pcb_trace_id: "A_0",
        route: candidate.route.map((point): PcbTrace["route"][number] => ({
          route_type: "wire",
          x: point.x,
          y: point.y,
          width: point.traceThickness ?? candidate.traceThickness,
          layer: "top",
        })),
      }
      return getDrcErrors(
        structuredClone([trace, pad, fixedVia]) as AnyCircuitElement[],
        {
          includeTraceContinuity: false,
          includeBoardEdge: false,
          traceClearance: 0.1,
          viaClearance: 0.1,
        },
      )
    }
    const obstacles = getPipeline9HighDensityForceObstacles({
      circuitJson: [pad] as AnyCircuitElement[],
      bounds,
      layerCount: 2,
      minTraceWidth: 0.1,
    })
    const target = getPipeline9PadCopperForceTarget({
      pad,
      route,
      obstacles,
      layerCount: 2,
    })
    if (!target) throw new Error("The physical fixture must target its pad")
    const original = structuredClone({ route, pad, fixedVia, obstacles, target })
    const initialErrors = evaluate(route).errors
    expect(initialErrors, String(padIndex)).toHaveLength(1)
    if (padIndex === 0) {
      expect(initialErrors[0]!.type).toBe("pcb_pad_trace_clearance_error")
    } else {
      expect(target.distance).toBe(0)
    }
    for (const direction of ["nearest", "opposite"] as const) {
      const candidate = structuredClone(route)
      const originalPoints = [...candidate.route]
      const originalVias = candidate.vias
      expect(
        applyPipeline9PadTraceDetour({
          route: candidate,
          target,
          pad,
          minimumClearance: 0.1,
          direction,
          bounds,
          layerCount: 2,
        }),
      ).toBe(true)
      expect(candidate.route).toHaveLength(6)
      expect(candidate.route[0]).toBe(originalPoints[0])
      expect(candidate.route.at(-1)).toBe(originalPoints[1])
      expect(candidate.vias).toBe(originalVias)
      expect(candidate.route[0]).toEqual(route.route[0])
      expect(candidate.route.at(-1)).toEqual(route.route.at(-1))
      for (const point of candidate.route.slice(1, -1)) {
        expect(point.traceThickness).toBe(
          route.route[0]!.traceThickness ?? route.traceThickness,
        )
        expect(point.pcb_port_id).toBeUndefined()
        expect(point.toNextSegmentType).toBeUndefined()
      }
      expect(evaluate(candidate).errors, `${padIndex}:${direction}`).toHaveLength(
        0,
      )
    }
    expect({ route, pad, fixedVia, obstacles, target }).toEqual(original)
  }
})
