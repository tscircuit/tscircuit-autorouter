import { expect, test } from "bun:test"
import { getAssignableViaPointKeys } from "lib/autorouter-pipelines/AutoroutingPipeline8/assignableViaUtils"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { precomputeSharedParams } from "lib/solvers/PortPointPathingSolver/precomputeSharedParams"
import type { Obstacle, SimpleRouteJson } from "lib/types"

test("fused geometry filtering preserves invalid-pitch exclusion, fallback, duplicate keys and input identity", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    obstacles: [],
    connections: [],
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
  }
  const nodes: InputNodeWithPortPoints[] = [
    2,
    4,
    0,
    -2,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ].map(
    (width, index): InputNodeWithPortPoints => ({
      capacityMeshNodeId: `n${index}`,
      center: { x: index, y: 0 },
      width,
      height: width,
      availableZ: [0, 1],
      portPoints: [],
    }),
  )
  const params = precomputeSharedParams(input, nodes)
  expect(params.avgNodePitch).toBe(3)
  expect(params.nodeMap.get("n0")).toBe(nodes[0])
  expect(precomputeSharedParams(input, nodes.slice(2)).avgNodePitch).toBe(1)
  expect(precomputeSharedParams(input, []).avgNodePitch).toBe(1)

  const obstacles: Obstacle[] = [
    {
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: 2, y: 3 },
      width: 1,
      height: 1,
      connectedTo: [],
      netIsAssignable: true,
      shape: "circle",
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: 8, y: 9 },
      width: 1,
      height: 1,
      connectedTo: [],
      netIsAssignable: true,
    },
    {
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: 4, y: 5 },
      width: 1,
      height: 1,
      connectedTo: [],
      netIsAssignable: false,
    },
    {
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: 2, y: 3 },
      width: 1,
      height: 1,
      connectedTo: [],
      netIsAssignable: true,
    },
    {
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: -1, y: 0 },
      width: 1,
      height: 1,
      connectedTo: [],
      netIsAssignable: true,
    },
  ]
  const before = structuredClone(obstacles)
  const expected = new Set(
    obstacles
      .filter(
        (obstacle) =>
          obstacle.netIsAssignable === true && obstacle.layers.length > 1,
      )
      .map(
        (obstacle) =>
          `${obstacle.center.x.toFixed(4)},${obstacle.center.y.toFixed(4)}`,
      ),
  )
  expect(getAssignableViaPointKeys(obstacles)).toEqual(expected)
  expect(getAssignableViaPointKeys(obstacles).size).toBe(2)
  expect(obstacles).toEqual(before)
})
