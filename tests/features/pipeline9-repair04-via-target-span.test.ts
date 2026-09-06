import { expect, test } from "bun:test"
import { checkViasInPads } from "@tscircuit/checks"
import type { AnyCircuitElement } from "circuit-json"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { identifyPipeline9ViaPadRepairTargets } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/identifyPipeline9ViaPadRepairTargets"

test("coincident blind vias grant movement only to the span identified by the actual placement checker", (): void => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "top-route",
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
      connectionName: "bottom-route",
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
  const circuitJson: AnyCircuitElement[] = [
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "top-pad",
      shape: "rect",
      x: 0,
      y: 0,
      width: 0.6,
      height: 0.6,
      layer: "top",
    },
    {
      type: "pcb_via",
      pcb_via_id: "top-via",
      pcb_trace_id: "top-route_0",
      x: 0,
      y: 0,
      outer_diameter: 0.3,
      hole_diameter: 0.15,
      layers: ["top", "inner1"],
    },
    {
      type: "pcb_via",
      pcb_via_id: "bottom-via",
      pcb_trace_id: "bottom-route_0",
      x: 0,
      y: 0,
      outer_diameter: 0.3,
      hole_diameter: 0.15,
      layers: ["inner2", "bottom"],
    },
  ]
  const errors = checkViasInPads(circuitJson).map(
    (error): Record<string, unknown> => ({ ...error, center: { x: 0, y: 0 } }),
  )
  expect(errors).toHaveLength(1)
  const identified = identifyPipeline9ViaPadRepairTargets({
    errors,
    circuitJson,
    routes,
    layerCount: 4,
  })
  expect(identified[0]!.existingViaRepairTargets).toEqual([
    { routeIndex: 0, viaIndex: 0, x: 0, y: 0 },
  ])
  const { existingViaRepairTargets: _targets, ...unchangedError } =
    identified[0]!
  expect(unchangedError).toEqual(errors[0])
})
