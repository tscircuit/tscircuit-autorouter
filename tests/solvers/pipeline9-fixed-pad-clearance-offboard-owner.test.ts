import { expect, test } from "bun:test"
import { createPipeline9FixedPadClearance } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9FixedPadClearance"
import type { SimpleRouteJson } from "lib/types/srj-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("a fixed rectangle retains its explicit off-board electrical owner without a geometry identifier", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections: [
      {
        name: "foreign",
        pointsToConnect: [{ x: -4, y: -4, layer: "bottom" }],
      },
    ],
    obstacles: [
      {
        type: "rect",
        connectedTo: [],
        offBoardConnectsTo: ["offboard-signal"],
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        layers: ["bottom"],
      },
    ],
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const owner = connMap.getNetConnectedToId("offboard-signal")
  const foreign = connMap.getNetConnectedToId("foreign")
  if (!owner || !foreign) throw new Error("Expected fixture canonical nets")
  const context = createPipeline9FixedPadClearance({
    obstacles: srj.obstacles,
    connMap,
    layerCount: srj.layerCount,
    traceToPadClearance: 0.1,
    viaToPadClearance: 0.15,
  })
  expect(context.rectangles[0]!.ownerNetIds).toEqual(new Set([owner]))
  for (const canonicalNetId of [owner, foreign]) {
    expect(
      context.traceClearanceIndex.isPointClear({
        point: { x: 0, y: 0, z: 1 },
        copperDiameter: 0.15,
        canonicalNetId,
      }),
    ).toBe(canonicalNetId === owner)
  }
})
