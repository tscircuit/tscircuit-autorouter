import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { identifyPipeline9ViaPadRepairTargets } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/identifyPipeline9ViaPadRepairTargets"

test("explicit via-trace identity selects only its owned physical span", (): void => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "upper-route",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [{ x: 0, y: 0 }],
      route: [
        { x: -2, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 2, y: 0, z: 1 },
      ],
    },
    {
      connectionName: "lower-route",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [{ x: 0, y: 0 }],
      route: [
        { x: -2, y: 0, z: 2 },
        { x: 0, y: 0, z: 2 },
        { x: 0, y: 0, z: 3 },
        { x: 2, y: 0, z: 3 },
      ],
    },
  ]
  const upperVia: Extract<AnyCircuitElement, { type: "pcb_via" }> = {
    type: "pcb_via",
    pcb_via_id: "opaque-via-alpha",
    pcb_trace_id: "final-trace-a",
    x: 0,
    y: 0,
    outer_diameter: 0.3,
    hole_diameter: 0.15,
    layers: ["top", "inner1"],
  }
  const lowerVia: Extract<AnyCircuitElement, { type: "pcb_via" }> = {
    ...upperVia,
    pcb_via_id: "opaque-via-beta",
    pcb_trace_id: "final-trace-b",
    layers: ["inner2", "bottom"],
  }
  const circuitJson: AnyCircuitElement[] = [
    upperVia,
    lowerVia,
    {
      type: "pcb_trace",
      pcb_trace_id: "foreign-trace",
      route: [
        { route_type: "wire", x: 0.25, y: -1, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0.25, y: 1, width: 0.1, layer: "top" },
      ],
    },
  ]
  const errors: Record<string, unknown>[] = getDrcErrors(circuitJson, {
    traceClearance: 0.1,
    includeTraceContinuity: false,
  }).errorsWithCenters.filter(
    (error): boolean => error.type === "pcb_via_trace_clearance_error",
  ).map((error): Record<string, unknown> => ({ ...error }))
  expect(errors).toHaveLength(1)
  expect(errors[0]).toMatchObject({
    pcb_via_id: upperVia.pcb_via_id,
    pcb_trace_id: "foreign-trace",
    center: { x: 0, y: 0 },
  })
  const finalTraceIdByConvertedTraceId = new Map<string, string>([
    ["upper-route_0", "final-trace-a"],
    ["lower-route_0", "final-trace-b"],
  ])
  const options = {
    errors, circuitJson, routes, layerCount: 4,
    finalTraceIdByConvertedTraceId,
  }
  const before = structuredClone({ errors, circuitJson, routes })
  const identified = identifyPipeline9ViaPadRepairTargets(options)
  expect(identified[0]!.existingViaRepairTargets).toEqual([
    { routeIndex: 0, viaIndex: 0, x: 0, y: 0 },
  ])
  const { existingViaRepairTargets: _targets, ...unchangedPayload } =
    identified[0]!
  expect(unchangedPayload).toEqual(errors[0])

  const unknownId = { ...errors[0], pcb_via_id: "unknown-via" }
  const wrongType = { ...errors[0], type: "pcb_trace_error" }
  const nonStringId = { ...errors[0], pcb_via_id: 7 }
  for (const error of [unknownId, wrongType, nonStringId]) {
    const result = identifyPipeline9ViaPadRepairTargets({
      ...options, errors: [error],
    })
    expect(result[0]).toBe(error)
  }

  const wrongSpans: AnyCircuitElement[][] = [
    [{ ...upperVia, layers: ["inner2", "bottom"] }, lowerVia],
    [{ ...upperVia, outer_diameter: 0.4 }, lowerVia],
    [{ ...upperVia, x: 0.01 }, lowerVia],
  ]
  for (const geometry of wrongSpans) {
    const result = identifyPipeline9ViaPadRepairTargets({
      ...options, circuitJson: geometry,
    })
    expect(result[0]).toBe(errors[0])
  }

  const unowned = { ...upperVia }
  delete unowned.pcb_trace_id
  const fixed = { ...upperVia, pcb_trace_id: "immutable-preloaded-trace" }
  for (const via of [unowned, fixed]) {
    const result = identifyPipeline9ViaPadRepairTargets({
      ...options, circuitJson: [via, lowerVia],
    })
    expect(result[0]).toBe(errors[0])
  }
  const otherError = { type: "unrelated_error", message: "keep exact payload" }
  const mixed = identifyPipeline9ViaPadRepairTargets({
    ...options, errors: [...errors, otherError],
  })
  expect(mixed[1]).toBe(otherError)
  expect({ errors, circuitJson, routes }).toEqual(before)
})
