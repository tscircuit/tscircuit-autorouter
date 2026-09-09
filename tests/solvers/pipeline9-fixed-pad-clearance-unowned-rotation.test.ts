import { expect, test } from "bun:test"
import { createPipeline9FixedPadClearance } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9FixedPadClearance"
import type { SimpleRouteJson } from "lib/types/srj-types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("an unowned rotated rectangle stays blocked when approximation removes its source identifier", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections: [
      {
        name: "foreign",
        pointsToConnect: [{ x: -4, y: -4, layer: "top" }],
      },
    ],
    obstacles: [
      {
        type: "rect",
        obstacleId: "unowned-rotated",
        connectedTo: [],
        center: { x: 0, y: 0 },
        width: 2,
        height: 0.25,
        ccwRotationDegrees: 45,
        layers: ["top"],
      },
    ],
  }
  const original = structuredClone(srj)
  const preprocessed = addApproximatingRectsToSrj(
    createSrjWithBoardValidObstacleLayers(srj),
  )
  expect(preprocessed.obstacles.length).toBeGreaterThan(1)
  const connMap = getConnectivityMapFromSimpleRouteJson(preprocessed)
  expect(connMap.getNetConnectedToId("unowned-rotated")).toBeUndefined()
  const foreign = connMap.getNetConnectedToId("foreign")
  if (!foreign) throw new Error("Expected fixture canonical net")
  const context = createPipeline9FixedPadClearance({
    obstacles: srj.obstacles,
    connMap,
    layerCount: srj.layerCount,
    traceToPadClearance: 0.1,
    viaToPadClearance: 0.15,
  })
  expect(context.rectangles).toHaveLength(1)
  expect(context.rectangles[0]).toMatchObject({
    center: { x: 0, y: 0 },
    width: 2,
    height: 0.25,
    ccwRotationDegrees: 45,
  })
  expect(context.rectangles[0]!.ownerNetIds).toEqual(new Set())
  expect(
    context.traceClearanceIndex.isPointClear({
      point: { x: 0, y: 0, z: 0 },
      copperDiameter: 0.15,
      canonicalNetId: foreign,
    }),
  ).toBeFalse()
  expect(srj).toEqual(original)
})
