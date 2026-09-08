import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9FixedPadClearance } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9FixedPadClearance"
import type { Obstacle } from "lib/types/srj-types"

test("Pipeline9 fixed-pad context preserves original rotation layers ownership and explicit rules", (): void => {
  const connMap = new ConnectivityMap({})
  connMap.addConnections([
    ["pad-a", "pad-port", "signal-a"],
    ["foreign-signal", "foreign-port"],
  ])
  const obstacles: Obstacle[] = [
    {
      type: "rect",
      obstacleId: "pad-a",
      center: { x: 0, y: 0 },
      width: 2,
      height: 0.25,
      ccwRotationDegrees: 45,
      layers: ["top"],
      zLayers: [2],
      connectedTo: ["pad-port"],
    },
    {
      type: "rect",
      obstacleId: "unclaimed-via",
      center: { x: 5, y: 5 },
      width: 0.3,
      height: 0.3,
      layers: ["top", "bottom"],
      connectedTo: ["unclaimed-via"],
      netIsAssignable: true,
    },
  ]
  const original = structuredClone(obstacles)
  const context = createPipeline9FixedPadClearance({
    obstacles,
    connMap,
    layerCount: 4,
    traceToPadClearance: 0,
    viaToPadClearance: 0.25,
  })
  expect(context.rectangles).toHaveLength(1)
  expect(context.rectangles[0]).toMatchObject({
    center: { x: 0, y: 0 },
    width: 2,
    height: 0.25,
    ccwRotationDegrees: 45,
    zLayers: [2],
  })
  const owner = connMap.getNetConnectedToId("signal-a")
  const foreign = connMap.getNetConnectedToId("foreign-signal")
  if (!owner || !foreign) throw new Error("Expected prepared fixture nets")
  expect(context.rectangles[0]!.ownerNetIds).toEqual(new Set([owner]))
  const query = {
    point: { x: 0.5, y: 0.5, z: 2 },
    copperDiameter: 0.125,
    canonicalNetId: foreign,
  }
  expect(context.traceClearanceIndex.isPointClear(query)).toBeFalse()
  expect(
    context.traceClearanceIndex.isPointClear({ ...query, canonicalNetId: owner }),
  ).toBeTrue()
  expect(
    context.traceClearanceIndex.isPointClear({
      ...query,
      point: { ...query.point, z: 0 },
    }),
  ).toBeTrue()
  expect(context.traceToPadClearance).toBe(0)
  expect(context.viaToPadClearance).toBe(0.25)
  expect(context.traceClearanceIndex.cacheFingerprint).not.toBe(
    context.viaClearanceIndex.cacheFingerprint,
  )
  expect(obstacles).toEqual(original)
  expect((): void => {
    createPipeline9FixedPadClearance({
      obstacles: [{ ...obstacles[0]!, connectedTo: ["unknown-owner"] }],
      connMap,
      layerCount: 4,
      traceToPadClearance: 0,
      viaToPadClearance: 0.25,
    })
  }).toThrow('no connectivity-map owner for "unknown-owner"')
  expect((): void => {
    createPipeline9FixedPadClearance({
      obstacles: [{ ...obstacles[0]!, connectedTo: [""] }],
      connMap,
      layerCount: 4,
      traceToPadClearance: 0,
      viaToPadClearance: 0.25,
    })
  }).toThrow("invalid electrical owner identifier")
  expect((): void => {
    createPipeline9FixedPadClearance({
      obstacles: [
        { ...obstacles[0]!, connectedTo: ["pad-port", "foreign-port"] },
      ],
      connMap,
      layerCount: 4,
      traceToPadClearance: 0,
      viaToPadClearance: 0.25,
    })
  }).toThrow("inconsistent canonical ownership")
})
