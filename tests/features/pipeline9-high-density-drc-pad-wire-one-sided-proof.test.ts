import { expect, test } from "bun:test"
import type { PcbTrace, PcbVia } from "circuit-json"
import {
  applyPipeline9PadTraceForce,
  getPipeline9PadTraceForceMobility,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9PadTraceForce"
import { getPipeline9PadCopperForceTarget } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PadCopperForceTarget"
import { getDrcErrors, type GetDrcErrorsResult } from "lib/testing/getDrcErrors"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("a synthetic pad repair can avoid a rigid move's foreign-via conflict by holding the far endpoint", (): void => {
  // Generic mechanism proof, not a captured sample12 board: the near endpoint
  // needs pad clearance while translating the far endpoint approaches a via.
  const route: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: "synthetic-pad-node",
    startPcbPortId: "A-start",
    endPcbPortId: "A-end",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: 0, z: 0, pcb_port_id: "A-start" },
      { x: -1, y: 0.2, z: 0, traceThickness: 0.1 },
      { x: 1, y: 0.2, z: 0, traceThickness: 0.1 },
      { x: 2, y: 0, z: 0, pcb_port_id: "A-end" },
    ],
    vias: [],
  }
  const pad = {
    type: "pcb_smtpad" as const,
    pcb_smtpad_id: "foreign-pad",
    pcb_component_id: "foreign-component",
    pcb_port_id: "foreign-port",
    shape: "rect" as const,
    x: -0.8,
    y: 0.42,
    width: 0.2,
    height: 0.2,
    layer: "top" as const,
  }
  // This is fixed standalone physical copper, not a via on the movable route.
  const via: PcbVia = {
    type: "pcb_via",
    pcb_via_id: "foreign-via",
    x: 1,
    y: -0.12,
    hole_diameter: 0.15,
    outer_diameter: 0.3,
    layers: ["top", "bottom"],
  }
  const obstacles: Obstacle[] = [
    {
      type: "rect",
      center: { x: pad.x, y: pad.y },
      width: pad.width,
      height: pad.height,
      layers: [pad.layer],
      connectedTo: [pad.pcb_smtpad_id],
    },
  ]
  const evaluate = (candidate: HighDensityRoute): GetDrcErrorsResult => {
    const trace: PcbTrace = {
      type: "pcb_trace",
      pcb_trace_id: "A_0",
      source_trace_id: "A",
      route: candidate.route.map((point, index): PcbTrace["route"][number] => ({
        route_type: "wire",
        x: point.x,
        y: point.y,
        width: point.traceThickness ?? candidate.traceThickness,
        layer: "top",
        start_pcb_port_id: index === 0 ? candidate.startPcbPortId : undefined,
        end_pcb_port_id:
          index === candidate.route.length - 1
            ? candidate.endPcbPortId
            : undefined,
      })),
    }
    // Public official checks build their own connectivity and retain overlap,
    // typed pad/via clearance and spacing checks; this open fixture has no board.
    return getDrcErrors(structuredClone([trace, pad, via]), {
      includeTraceContinuity: false,
      includeBoardEdge: false,
      traceClearance: 0.1,
      viaClearance: 0.1,
    })
  }
  const original = structuredClone({ route, pad, via, obstacles })
  const initialErrors = evaluate(route).errors
  expect(initialErrors).toHaveLength(1)
  expect(initialErrors[0]).toMatchObject({
    type: "pcb_pad_trace_clearance_error",
    pcb_trace_id: "A_0",
    pcb_pad_id: "foreign-pad",
  })
  const padError = initialErrors.find(
    (error) => error.type === "pcb_pad_trace_clearance_error",
  )
  if (!padError || typeof padError.minimum_clearance !== "number") {
    throw new Error("The synthetic fixture requires an official pad clearance")
  }
  const target = getPipeline9PadCopperForceTarget({
    pad,
    route,
    obstacles,
    layerCount: 2,
  })
  if (!target) throw new Error("The synthetic fixture requires its pad target")
  expect(target.segmentIndex).toBe(1)
  const originalTarget = structuredClone(target)
  expect(
    getPipeline9PadTraceForceMobility({
      route,
      target,
      protectedPointIndexes: new Set(),
    }),
  ).toEqual({ pointIndexes: [1, 2], contactWeight: 1 })

  const rigid = structuredClone(route)
  expect(
    applyPipeline9PadTraceForce({
      route: rigid,
      target,
      protectedPointIndexes: new Set(),
      minimumClearance: padError.minimum_clearance,
      scale: 1,
    }),
  ).toBe(true)
  const rigidErrors = evaluate(rigid).errors
  expect(
    rigidErrors.filter(
      (error) => error.type === "pcb_pad_trace_clearance_error",
    ),
  ).toHaveLength(0)
  expect(rigidErrors).toHaveLength(1)
  expect(rigidErrors[0]).toMatchObject({
    type: "pcb_via_trace_clearance_error",
    pcb_trace_id: "A_0",
    pcb_via_id: "foreign-via",
  })
  expect(rigid.route[1]!.y).toBeLessThan(route.route[1]!.y)
  expect(rigid.route[2]!.y).toBeLessThan(route.route[2]!.y)

  const oneEndpoint = structuredClone(route)
  const heldPointIndexes = new Set([2])
  expect(
    getPipeline9PadTraceForceMobility({
      route: oneEndpoint,
      target,
      protectedPointIndexes: heldPointIndexes,
    }).pointIndexes,
  ).toEqual([1])
  expect(
    applyPipeline9PadTraceForce({
      route: oneEndpoint,
      target,
      protectedPointIndexes: heldPointIndexes,
      minimumClearance: padError.minimum_clearance,
      scale: 1,
    }),
  ).toBe(true)
  expect(evaluate(oneEndpoint).errors).toHaveLength(0)
  expect(oneEndpoint.route[1]!.y).toBeLessThan(route.route[1]!.y)
  expect(oneEndpoint.route[2]).toEqual(route.route[2])
  for (const candidate of [rigid, oneEndpoint]) {
    expect(candidate.route[0]).toEqual(route.route[0])
    expect(candidate.route.at(-1)).toEqual(route.route.at(-1))
    expect(candidate.vias).toEqual(route.vias)
    expect(candidate).toEqual({ ...route, route: candidate.route })
  }
  expect(heldPointIndexes).toEqual(new Set([2]))
  expect(target).toEqual(originalTarget)
  expect({ route, pad, via, obstacles }).toEqual(original)
})
