import { expect, test } from "bun:test"
import {
  createTopologyMergingTestNode,
  getAvailableZAtPoint,
  solveTopologyMergingTestGroups,
} from "../../../fixtures/topology-merging-test-utils"

const sharedBounds = { minX: 0, maxX: 2, minY: 0, maxY: 2 }

test("topology merging joins aligned via-sized free layers", (): void => {
  const nodes = solveTopologyMergingTestGroups(
    [
      {
        groupId: "top-layer",
        nodes: [
          createTopologyMergingTestNode({
            id: "top-free",
            bounds: sharedBounds,
            availableZ: [0],
          }),
        ],
      },
      {
        groupId: "bottom-layer",
        nodes: [
          createTopologyMergingTestNode({
            id: "bottom-free",
            bounds: sharedBounds,
            availableZ: [1],
          }),
        ],
      },
    ],
    { layerCount: 2, viaDiameter: 0.6 },
  )

  expect(getAvailableZAtPoint(nodes, { x: 1, y: 1 })).toEqual([[0, 1]])
  expect(nodes).toHaveLength(1)
  expect(nodes[0]?._containsObstacle).toBeUndefined()
})

test("topology merging keeps an obstructed layer separate", (): void => {
  const obstructedBottomLayer = {
    ...createTopologyMergingTestNode({
      id: "bottom-obstacle",
      bounds: sharedBounds,
      availableZ: [1],
    }),
    _containsObstacle: true,
  }
  const nodes = solveTopologyMergingTestGroups(
    [
      {
        groupId: "top-layer",
        nodes: [
          createTopologyMergingTestNode({
            id: "top-free",
            bounds: sharedBounds,
            availableZ: [0],
          }),
        ],
      },
      {
        groupId: "bottom-layer",
        nodes: [obstructedBottomLayer],
      },
    ],
    { layerCount: 2, viaDiameter: 0.6 },
  )

  expect(getAvailableZAtPoint(nodes, { x: 1, y: 1 })).toEqual([[0], [1]])
  expect(nodes).toHaveLength(2)
})

test("topology merging keeps free layers separate when a via cannot fit", (): void => {
  const narrowBounds = { minX: 0, maxX: 0.5, minY: 0, maxY: 2 }
  const nodes = solveTopologyMergingTestGroups(
    [
      {
        groupId: "top-layer",
        nodes: [
          createTopologyMergingTestNode({
            id: "top-free",
            bounds: narrowBounds,
            availableZ: [0],
          }),
        ],
      },
      {
        groupId: "bottom-layer",
        nodes: [
          createTopologyMergingTestNode({
            id: "bottom-free",
            bounds: narrowBounds,
            availableZ: [1],
          }),
        ],
      },
    ],
    { layerCount: 2, viaDiameter: 0.6 },
  )

  expect(getAvailableZAtPoint(nodes, { x: 0.25, y: 1 })).toEqual([[0], [1]])
  expect(nodes).toHaveLength(2)
})

test("topology merging does not bridge a blocked intermediate layer", (): void => {
  const layerNodes = [
    createTopologyMergingTestNode({
      id: "noncontiguous-free",
      bounds: sharedBounds,
      availableZ: [0, 2],
    }),
    {
      ...createTopologyMergingTestNode({
        id: "middle-obstacle",
        bounds: sharedBounds,
        availableZ: [1],
      }),
      _containsObstacle: true,
    },
    createTopologyMergingTestNode({
      id: "bottom-free",
      bounds: sharedBounds,
      availableZ: [3],
    }),
  ]
  const nodes = solveTopologyMergingTestGroups(
    layerNodes.map((node, index) => ({
      groupId: `layer-topology-${index}`,
      nodes: [node],
    })),
    { layerCount: 4, viaDiameter: 0.6 },
  )

  expect(getAvailableZAtPoint(nodes, { x: 1, y: 1 })).toEqual([
    [0, 2],
    [1],
    [3],
  ])
})
