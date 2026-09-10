import { expect, test } from "bun:test"
import { doHdRoutesTouch } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/doHdRoutesTouch"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("shortcut contact checks respect copper width and via layer spans", (): void => {
  const trace: HighDensityRoute = {
    connectionName: "trace", traceThickness: 0.2, viaDiameter: 0.4, vias: [],
    route: [{ x: -1, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }],
  }
  const via: HighDensityRoute = {
    ...trace, connectionName: "via", vias: [{ x: 0, y: 0.25 }],
    route: [{ x: 0, y: 0.25, z: 0 }, { x: 0, y: 0.25, z: 2 }],
  }
  expect(doHdRoutesTouch(trace, via)).toBe(true)
  expect(doHdRoutesTouch(trace, { ...via, route: via.route.map((point) => ({ ...point, y: 0.35 })) })).toBe(false)
  expect(doHdRoutesTouch({ ...trace, route: trace.route.map((point) => ({ ...point, z: 3 })) }, via)).toBe(false)
  expect(doHdRoutesTouch(trace, { ...trace, route: trace.route.map((point) => ({ ...point, z: 0 })) })).toBe(false)
})
