import { expect, test } from "bun:test"
import {
  deserializePipeline9FixedPadClearance,
  serializePipeline9FixedPadClearanceForNode,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9NetworkedFixedPadClearance"
import type { Pipeline9NetworkedFixedPadClearance } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9NetworkedTypes"
import { createPipeline9FixedPadClearance } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9FixedPadClearance"
import { createNetworkFixedPadProblem } from "../fixtures/createNetworkFixedPadProblem"

test("fixed-pad JSON preserves canonical owners rotation all layers zero rules and detached geometry", (): void => {
  const { node, connMap } = createNetworkFixedPadProblem()
  const original = createPipeline9FixedPadClearance({
    connMap,
    layerCount: 2,
    traceToPadClearance: 0,
    viaToPadClearance: 0.125,
    obstacles: [
      {
        type: "rect",
        center: { x: 0.65, y: 0 },
        width: 0.1,
        height: 1,
        ccwRotationDegrees: 90,
        layers: ["bottom"],
        connectedTo: ["foreign-pad"],
      },
      {
        type: "rect",
        center: { x: 0, y: -0.4 },
        width: 0.1,
        height: 0.1,
        ccwRotationDegrees: 0,
        layers: ["top"],
        connectedTo: [],
      },
      {
        type: "rect",
        center: { x: 100, y: 100 },
        width: 1,
        height: 1,
        layers: ["top"],
        connectedTo: ["foreign-pad"],
      },
    ],
  })
  const serialized = serializePipeline9FixedPadClearanceForNode({
    node,
    fixedPadClearance: original,
    traceWidth: 0.2,
    viaDiameter: 0.3,
  })
  expect(serialized.rectangles).toHaveLength(2)
  expect(serialized.traceToPadClearance).toBe(0)
  expect(serialized.viaToPadClearance).toBe(0.125)
  expect(serialized.rectangles[0]).toMatchObject({
    ccwRotationDegrees: 90,
    zLayers: [1],
    ownerNetIds: ["foreign-canonical-net"],
  })
  expect(serialized.rectangles[1]).toMatchObject({
    ccwRotationDegrees: 0,
    zLayers: [0],
    ownerNetIds: [],
  })
  const jsonCopy = JSON.parse(
    JSON.stringify(serialized),
  ) as Pipeline9NetworkedFixedPadClearance
  const restored = deserializePipeline9FixedPadClearance(jsonCopy)
  expect(restored.rectangles).toEqual(original.rectangles.slice(0, 2))
  expect(restored.rectangles[0]?.center).not.toBe(jsonCopy.rectangles[0]?.center)
  expect(restored.rectangles[0]?.zLayers).not.toBe(jsonCopy.rectangles[0]?.zLayers)
  expect(serialized.rectangles[0]?.center).not.toBe(original.rectangles[0]?.center)
  for (const z of [0, 1]) {
    for (const x of [-0.25, 0, 0.25]) {
      for (const y of [-0.25, 0, 0.25]) {
        for (const canonicalNetId of ["route-net", "foreign-canonical-net"]) {
          const query = {
            point: { x, y, z },
            canonicalNetId,
            copperDiameter: 0.2,
          }
          expect(restored.traceClearanceIndex.isPointClear(query)).toBe(
            original.traceClearanceIndex.isPointClear(query),
          )
          const viaQuery = { ...query, copperDiameter: 0.3 }
          expect(restored.viaClearanceIndex.isPointClear(viaQuery)).toBe(
            original.viaClearanceIndex.isPointClear(viaQuery),
          )
        }
      }
    }
  }
  expect((): void => {
    deserializePipeline9FixedPadClearance({
      ...jsonCopy,
      rectangles: [
        {
          ...jsonCopy.rectangles[0]!,
          ownerNetIds: ["route-net", "foreign-canonical-net"],
        },
      ],
    })
  }).toThrow("invalid canonical ownership")
})
