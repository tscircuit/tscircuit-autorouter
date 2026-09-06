import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { doesPipeline9SeamTouchSameNetCopper } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/doesPipeline9SeamTouchSameNetCopper"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 protects fixed copper touching only the exact peer handoff", (): void => {
  const seamStart = { x: 0, y: 0.3, z: 0 }
  const seamEnd = { x: 0.0004, y: 0.3, z: 0 }
  const route: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    traceThickness: 0.1,
    viaDiameter: 0.1,
    route: [{ x: -1, y: 0.3, z: 0 }, seamStart],
    vias: [],
  }
  const wire: HighDensityRoute = {
    ...route,
    connectionName: "fixed-A",
    route: [
      { x: 0.1003, y: 0.3, z: 0 },
      { x: 1, y: 0.3, z: 0 },
    ],
  }
  const via: HighDensityRoute = {
    ...wire,
    route: [
      { x: 0.1003, y: 0.3, z: 0 },
      { x: 0.1003, y: 0.3, z: 1 },
    ],
    vias: [{ x: 0.1003, y: 0.3 }],
  }
  const connMap = new ConnectivityMap({ A: ["A", "fixed-A"] })
  const original = structuredClone({ route, wire, via })
  for (const immutableRoute of [wire, via]) {
    expect(
      doesPipeline9SeamTouchSameNetCopper({
        route,
        seamStart,
        seamEnd: seamStart,
        immutableRoutes: [immutableRoute],
        connMap,
      }),
    ).toBeFalse()
    expect(
      doesPipeline9SeamTouchSameNetCopper({
        route,
        seamStart,
        seamEnd,
        immutableRoutes: [immutableRoute],
        connMap,
      }),
    ).toBeTrue()
  }
  expect({ route, wire, via }).toEqual(original)
})
