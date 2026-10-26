import { expect, test } from "bun:test"
import {
  createTopologyMergingTestNode,
  solveTopologyMergingTestGroups,
} from "../../../fixtures/topology-merging-test-utils"

test("component target restoration retains clipping by global targets only on overlapping layers", (): void => {
  const pad = {
    ...createTopologyMergingTestNode({
      id: "thermal-pad",
      bounds: { minX: 0, maxX: 4, minY: 0, maxY: 4 },
      availableZ: [0, 1],
    }),
    _containsObstacle: true,
    _containsTarget: true,
    _targetConnectionName: "ground",
    _connectedTo: ["ep"],
  }
  for (const { bounds, availableZ, clipped } of [
    {
      bounds: { minX: 1, maxX: 2, minY: 1, maxY: 2 },
      availableZ: [0],
      clipped: true,
    },
    {
      bounds: { minX: 3, maxX: 5, minY: 1, maxY: 2 },
      availableZ: [0],
      clipped: true,
    },
    {
      bounds: { minX: 1, maxX: 2, minY: 1, maxY: 2 },
      availableZ: [2],
      clipped: false,
    },
    {
      bounds: { minX: 4, maxX: 5, minY: 1, maxY: 2 },
      availableZ: [0],
      clipped: false,
    },
  ]) {
    const globalTarget = {
      ...createTopologyMergingTestNode({
        id: "trace-target",
        bounds,
        availableZ,
      }),
      _containsObstacle: true,
      _containsTarget: true,
      _targetConnectionName: "ground",
      _connectedTo: ["ep"],
    }
    const snapshot = structuredClone([pad, globalTarget])
    const output = solveTopologyMergingTestGroups([
      { groupId: "global", nodes: [globalTarget], isComponent: false },
      { groupId: "component", nodes: [pad], isComponent: true },
    ])
    expect(
      output.find((node) => node.capacityMeshNodeId === "trace-target"),
    ).toMatchObject(globalTarget)
    const componentNodes = output.filter(
      (node) => node._isComponentTopologyNode,
    )
    expect(
      componentNodes.every(
        (node) => node._containsTarget && node._containsObstacle,
      ),
    ).toBe(true)
    expect(
      componentNodes.every((node) => node._connectedTo?.join() === "ep"),
    ).toBe(true)
    if (clipped) {
      expect(
        componentNodes.some(
          (node) => node.capacityMeshNodeId === "thermal-pad",
        ),
      ).toBe(false)
    } else {
      expect(
        componentNodes.find(
          (node) => node.capacityMeshNodeId === "thermal-pad",
        ),
      ).toMatchObject(pad)
    }
    for (const z of [0, 1, 2]) {
      const globalArea = availableZ.includes(z)
        ? globalTarget.width * globalTarget.height
        : 0
      const overlapArea =
        clipped && z === 0
          ? (Math.min(4, bounds.maxX) - Math.max(0, bounds.minX)) *
            (Math.min(4, bounds.maxY) - Math.max(0, bounds.minY))
          : 0
      const expectedArea =
        (pad.availableZ.includes(z) ? 16 : 0) + globalArea - overlapArea
      expect(
        output
          .filter((node) => node.availableZ.includes(z))
          .reduce((area, node) => area + node.width * node.height, 0),
      ).toBeCloseTo(expectedArea, 12)
    }
    expect([pad, globalTarget]).toEqual(snapshot)
  }
})
