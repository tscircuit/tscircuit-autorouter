import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { arePipeline9NativeRoutesPhysicallyValid } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/arePipeline9NativeRoutesPhysicallyValid"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("native wire capsules honor rotated pads, circles, layer spans and independent non-plated hole clearance", (): void => {
  const wire: HighDensityRoute = { connectionName: "wire", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }], vias: [] }
  const pad: Obstacle = { type: "rect", center: { x: 0, y: 0.3 }, width: 0.4, height: 0.1,
    layers: ["top"], connectedTo: ["foreign"] }
  const params = { routes: [wire], connMap: new ConnectivityMap({ owned: ["wire", "own-pad"], other: ["foreign"] }),
    layerCount: 2, traceClearance: 0.1, viaHoleDiameter: 0.15,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.1, viaToPadClearance: 0.1 }
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...params, boardObstacles: [pad] })).toBeTrue()
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...params, boardObstacles: [{ ...pad, ccwRotationDegrees: 45 }] })).toBeFalse()
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...params, boardObstacles: [{ ...pad, ccwRotationDegrees: 45, layers: ["bottom"] }] })).toBeTrue()
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...params, boardObstacles: [{ ...pad, center: { x: 0, y: 0 }, connectedTo: ["own-pad"] }] })).toBeTrue()
  const circle: Obstacle = { ...pad, shape: "circle", center: { x: 0, y: 0.251 }, width: 0.2, height: 0.2 }
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...params, boardObstacles: [circle], traceToPadClearance: 0.05 })).toBeTrue()
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...params, boardObstacles: [circle], traceToPadClearance: 0.2 })).toBeFalse()
  const hole: Obstacle = { ...circle, isNonPlatedHole: true, layers: ["bottom"], connectedTo: ["own-pad"] }
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...params, boardObstacles: [hole] })).toBeFalse()
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...params, boardObstacles: [hole], traceToHoleClearance: 0.05 })).toBeTrue()
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...params, boardObstacles: [hole], traceToHoleClearance: 0.3 })).toBeFalse()
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...params, boardObstacles: [pad], routeDimensionsByConnectionName: { wire: { traceThickness: 0.5, viaDiameter: 0.3 } } })).toBeFalse()
})
