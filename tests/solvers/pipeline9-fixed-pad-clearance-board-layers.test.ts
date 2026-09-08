import { expect, test } from "bun:test"
import { createPipeline9FixedPadClearance } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9FixedPadClearance"
import type { Obstacle, SimpleRouteJson } from "lib/types/srj-types"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("fixed-pad layers use the same board-valid policy as preprocessing without changing original geometry", (): void => {
  const layerDeclarations: Pick<
    Obstacle,
    "layers" | "zLayers" | "__zLayers"
  >[] = [
    { layers: ["bottom"], zLayers: [] },
    { layers: ["bottom"], zLayers: [99] },
    { layers: ["top"], __zLayers: [], zLayers: [2] },
    { layers: ["top"], __zLayers: [99, 2, 2], zLayers: [1] },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections: [],
    obstacles: layerDeclarations.map(
      (declaration, index): Obstacle => ({
        type: "rect",
        connectedTo: [],
        center: { x: index, y: 0 },
        width: 0.5,
        height: 0.25,
        ccwRotationDegrees: 45,
        ...declaration,
      }),
    ),
  }
  const original = structuredClone(srj)
  const normalized = createSrjWithBoardValidObstacleLayers(srj)
  const connMap = getConnectivityMapFromSimpleRouteJson(normalized)
  const context = createPipeline9FixedPadClearance({
    obstacles: srj.obstacles,
    connMap,
    layerCount: srj.layerCount,
    traceToPadClearance: 0.1,
    viaToPadClearance: 0.15,
  })
  expect(context.rectangles.map((rectangle) => rectangle.zLayers)).toEqual([
    [3],
    [3],
    [0],
    [2],
  ])
  expect(context.rectangles.map((rectangle) => rectangle.zLayers)).toEqual(
    normalized.obstacles.map((obstacle): number[] => {
      const zLayers = obstacle.__zLayers
      if (zLayers === undefined) {
        throw new Error("Preprocessing must produce canonical obstacle layers")
      }
      return zLayers
    }),
  )
  for (const [index, rectangle] of context.rectangles.entries()) {
    expect(rectangle).toMatchObject({
      center: srj.obstacles[index]!.center,
      width: 0.5,
      height: 0.25,
      ccwRotationDegrees: 45,
    })
  }
  expect(srj).toEqual(original)
  expect((): void => {
    createPipeline9FixedPadClearance({
      obstacles: [{ ...srj.obstacles[0]!, layers: [], zLayers: [99] }],
      connMap,
      layerCount: srj.layerCount,
      traceToPadClearance: 0.1,
      viaToPadClearance: 0.15,
    })
  }).toThrow("has no layers on this 4-layer board")
})
