import { expect, test } from "bun:test"
import { createPipeline9FixedPadClearance } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9FixedPadClearance"
import type { Obstacle, SimpleRouteJson } from "lib/types/srj-types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("original pad ownership survives preprocessing that deduplicates geometry identifiers", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "port-a" },
          { x: 0, y: 0, layer: "top", pcb_port_id: "port-b" },
        ],
      },
      {
        name: "foreign",
        pointsToConnect: [{ x: 4, y: 4, layer: "top" }],
      },
    ],
    obstacles: ["a", "b"].map((suffix): Obstacle => ({
      type: "rect",
      obstacleId: `pad-${suffix}`,
      connectedTo: [`port-${suffix}`],
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      layers: ["top"],
    })),
  }
  const original = structuredClone(srj)
  const preprocessed = addApproximatingRectsToSrj(
    createSrjWithBoardValidObstacleLayers(srj),
  )
  expect(preprocessed.obstacles).toHaveLength(1)
  expect(preprocessed.obstacles[0]!.connectedTo).toEqual(["port-a", "port-b"])
  const connMap = getConnectivityMapFromSimpleRouteJson(preprocessed)
  expect(connMap.getNetConnectedToId("pad-b")).toBeUndefined()
  const owner = connMap.getNetConnectedToId("signal")
  const foreign = connMap.getNetConnectedToId("foreign")
  if (!owner || !foreign) throw new Error("Expected fixture canonical nets")
  const context = createPipeline9FixedPadClearance({
    obstacles: srj.obstacles,
    connMap,
    layerCount: srj.layerCount,
    traceToPadClearance: 0.1,
    viaToPadClearance: 0.15,
  })
  expect(context.rectangles).toHaveLength(2)
  for (const rectangle of context.rectangles) {
    expect(rectangle.ownerNetIds).toEqual(new Set([owner]))
  }
  for (const canonicalNetId of [owner, foreign]) {
    expect(
      context.traceClearanceIndex.isPointClear({
        point: { x: 0, y: 0, z: 0 },
        copperDiameter: 0.15,
        canonicalNetId,
      }),
    ).toBe(canonicalNetId === owner)
  }
  expect(srj).toEqual(original)
})
