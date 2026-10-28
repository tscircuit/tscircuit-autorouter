import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { arePipeline9NativeRoutesPhysicallyValid } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/arePipeline9NativeRoutesPhysicallyValid"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("native physical sites preserve blind spans, exact same-owner reuse, and non-plated hole exclusion", (): void => {
  const via: HighDensityRoute = { connectionName: "a", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }], vias: [{ x: 0, y: 0 }] }
  const params = { connMap: new ConnectivityMap({ shared: ["a", "same"], foreign: ["b"] }),
    layerCount: 4, allowBlindAndBuriedVias: true, traceClearance: 0.1,
    viaHoleDiameter: 0.15, minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    boardObstacles: [], viaToPadClearance: 0.1 }
  const disjoint = { ...via, connectionName: "b", route: [{ x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: 3 }] }
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...params, routes: [via, disjoint] })).toBeTrue()
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...params, allowBlindAndBuriedVias: false, routes: [via, disjoint] })).toBeFalse()
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...params, routes: [via, { ...via, connectionName: "same" }] })).toBeTrue()
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...params, routes: [via, { ...via, connectionName: "same", route: [{ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 2 }] }] })).toBeFalse()
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...params, routes: [via], boardObstacles: [{
    type: "rect", center: { x: 0, y: 0 }, width: 0.3, height: 0.3,
    layers: ["top"], connectedTo: ["a"], isNonPlatedHole: true,
  }] })).toBeFalse()
})
