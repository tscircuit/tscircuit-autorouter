import { expect, test } from "bun:test"
import { routeIntersectsRegionInSingleInterval } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/apply-pipeline9-via-pad-clearance-repairs"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 via-pad regional cleanup requires one contiguous route interval", () => {
  const contiguousCrossing: HighDensityRoute = {
    connectionName: "contiguous",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: 0, z: 0, pcb_port_id: "contiguous_start" },
      { x: -0.5, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0.5, y: 0, z: 1 },
      { x: 2, y: 0, z: 1, pcb_port_id: "contiguous_end" },
    ],
    vias: [{ x: 0, y: 0 }],
  }
  const exitAndReenter: HighDensityRoute = {
    connectionName: "reentry",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: 0, z: 0, pcb_port_id: "reentry_start" },
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 2, z: 0 },
      { x: 0, y: 2, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: -2, y: 0, z: 0, pcb_port_id: "reentry_end" },
    ],
    vias: [],
  }
  const boundaryTouchWithTransition: HighDensityRoute = {
    connectionName: "boundary",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: -1, z: 0, pcb_port_id: "boundary_start" },
      { x: -1, y: -1, z: 0 },
      { x: -1, y: -1, z: 1 },
      { x: -2, y: -1, z: 1, pcb_port_id: "boundary_end" },
    ],
    vias: [{ x: -1, y: -1 }],
  }
  const adjacentSegmentReentry: HighDensityRoute = {
    connectionName: "adjacent_reentry",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: 0, z: 0, pcb_port_id: "adjacent_start" },
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 2, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: -2, y: 0, z: 0, pcb_port_id: "adjacent_end" },
    ],
    vias: [],
  }
  const region = { center: { x: 0, y: 0 }, regionSize: 2 }

  expect(
    routeIntersectsRegionInSingleInterval({
      route: contiguousCrossing,
      ...region,
    }),
  ).toBeTrue()
  expect(
    routeIntersectsRegionInSingleInterval({
      route: exitAndReenter,
      ...region,
    }),
  ).toBeFalse()
  expect(
    routeIntersectsRegionInSingleInterval({
      route: boundaryTouchWithTransition,
      ...region,
    }),
  ).toBeTrue()
  expect(
    routeIntersectsRegionInSingleInterval({
      route: adjacentSegmentReentry,
      ...region,
    }),
  ).toBeFalse()
})
