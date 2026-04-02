import { expect, test } from "bun:test"
import { getHighDensityNodeDownloadData } from "lib/testing/utils/getHighDensityNodeDownloadData"

test("getHighDensityNodeDownloadData finds pipeline 4 node data from solver outputs", () => {
  const solver = {
    nodeSolver: {
      getOutput: () => ({
        meshNodes: [
          {
            capacityMeshNodeId: "cn_1",
            center: { x: 1, y: 2 },
          },
        ],
      }),
    },
    portPointPathingSolver: {
      getOutput: () => ({
        nodesWithPortPoints: [
          {
            capacityMeshNodeId: "cn_1",
            portPoints: [{ portPointId: "pp1", x: 1, y: 1, z: 0 }],
          },
        ],
        inputNodeWithPortPoints: [
          {
            capacityMeshNodeId: "cn_1",
            portPoints: [{ portPointId: "pp1", connectionNodeIds: [] }],
          },
        ],
      }),
    },
    uniformPortDistributionSolver: {
      getOutput: () => [
        {
          capacityMeshNodeId: "cn_1",
          portPoints: [{ portPointId: "pp1", x: 3, y: 4, z: 0 }],
        },
      ],
    },
  } as any

  expect(getHighDensityNodeDownloadData(solver, "cn_1") as any).toEqual({
    nodeId: "cn_1",
    capacityMeshNode: {
      capacityMeshNodeId: "cn_1",
      center: { x: 1, y: 2 },
    },
    nodeWithPortPoints: {
      capacityMeshNodeId: "cn_1",
      portPoints: [{ portPointId: "pp1", x: 3, y: 4, z: 0 }],
    },
    inputNodeWithPortPoints: {
      capacityMeshNodeId: "cn_1",
      portPoints: [{ portPointId: "pp1", connectionNodeIds: [] }],
    },
  })
})

test("getHighDensityNodeDownloadData falls back to legacy solver collections", () => {
  const solver = {
    nodeTargetMerger: {
      newNodes: [{ capacityMeshNodeId: "cn_2", source: "node-target-merger" }],
    },
    portPointPathingSolver: {
      getNodesWithPortPoints: () => [
        { capacityMeshNodeId: "cn_2", source: "port-point-pathing" },
      ],
    },
  } as any

  expect(getHighDensityNodeDownloadData(solver, "cn_2") as any).toEqual({
    nodeId: "cn_2",
    capacityMeshNode: {
      capacityMeshNodeId: "cn_2",
      source: "node-target-merger",
    },
    nodeWithPortPoints: {
      capacityMeshNodeId: "cn_2",
      source: "port-point-pathing",
    },
    inputNodeWithPortPoints: null,
  })
})

test("getHighDensityNodeDownloadData prefers preserved high-density node input over intermediate collections", () => {
  const solver = {
    highDensityNodePortPoints: [
      {
        capacityMeshNodeId: "cn_3",
        center: { x: 5, y: 6 },
        width: 2,
        height: 2,
        portPoints: [
          { portPointId: "pp1", x: 4, y: 5, z: 0 },
          { portPointId: "pp2", x: 6, y: 5, z: 0 },
          { portPointId: "pp3", x: 5, y: 7, z: 1 },
        ],
      },
    ],
    uniformPortDistributionSolver: {
      getOutput: () => [
        {
          capacityMeshNodeId: "cn_3",
          center: { x: 5, y: 6 },
          width: 2,
          height: 2,
          portPoints: [{ portPointId: "pp1", x: 4, y: 5, z: 0 }],
        },
      ],
    },
  } as any

  expect(
    (getHighDensityNodeDownloadData(solver, "cn_3") as any).nodeWithPortPoints,
  ).toEqual({
    capacityMeshNodeId: "cn_3",
    center: { x: 5, y: 6 },
    width: 2,
    height: 2,
    portPoints: [
      { portPointId: "pp1", x: 4, y: 5, z: 0 },
      { portPointId: "pp2", x: 6, y: 5, z: 0 },
      { portPointId: "pp3", x: 5, y: 7, z: 1 },
    ],
  })
})

test("getHighDensityNodeDownloadData can read node data from high-density solver metadata", () => {
  const solver = {
    highDensityRouteSolver: {
      nodeSolveMetadataById: new Map([
        [
          "cn_4",
          {
            node: {
              capacityMeshNodeId: "cn_4",
              center: { x: 10, y: 11 },
              width: 3,
              height: 1,
              portPoints: [
                { portPointId: "pp1", x: 9, y: 11, z: 0 },
                { portPointId: "pp2", x: 11, y: 11, z: 1 },
              ],
            },
          },
        ],
      ]),
    },
  } as any

  expect(
    (getHighDensityNodeDownloadData(solver, "cn_4") as any).nodeWithPortPoints,
  ).toEqual({
    capacityMeshNodeId: "cn_4",
    center: { x: 10, y: 11 },
    width: 3,
    height: 1,
    portPoints: [
      { portPointId: "pp1", x: 9, y: 11, z: 0 },
      { portPointId: "pp2", x: 11, y: 11, z: 1 },
    ],
  })
})

test("getHighDensityNodeDownloadData can fall back to constructor params in the active solver tree", () => {
  const solver = {
    activeSubSolver: {
      getConstructorParams: () => [
        {
          nodeWithPortPoints: [
            {
              capacityMeshNodeId: "new-cmn_0-0",
              center: { x: 2, y: 3 },
              width: 1,
              height: 1,
              portPoints: [
                { portPointId: "pp1", x: 1.5, y: 3, z: 0 },
                { portPointId: "pp2", x: 2.5, y: 3, z: 1 },
              ],
            },
          ],
        },
      ],
    },
  } as any

  expect(
    (getHighDensityNodeDownloadData(solver, "new-cmn_0-0") as any)
      .nodeWithPortPoints,
  ).toEqual({
    capacityMeshNodeId: "new-cmn_0-0",
    center: { x: 2, y: 3 },
    width: 1,
    height: 1,
    portPoints: [
      { portPointId: "pp1", x: 1.5, y: 3, z: 0 },
      { portPointId: "pp2", x: 2.5, y: 3, z: 1 },
    ],
  })
})

test("getHighDensityNodeDownloadData prefers solver metadata before touching throwing fallback getters", () => {
  const solver = {
    highDensityRouteSolver: {
      nodeSolveMetadataById: new Map([
        [
          "cmn_47__sub_2_1",
          {
            node: {
              capacityMeshNodeId: "cmn_47__sub_2_1",
              center: { x: 1, y: 2 },
              width: 3,
              height: 4,
              portPoints: [
                { portPointId: "pp1", x: 1, y: 1, z: 0 },
                { portPointId: "pp2", x: 2, y: 2, z: 1 },
              ],
            },
          },
        ],
      ]),
    },
    someThrowingSolver: {
      getOutput: () => {
        throw new Error("should not be called")
      },
    },
  } as any

  expect(
    (getHighDensityNodeDownloadData(solver, "cmn_47__sub_2_1") as any)
      .nodeWithPortPoints,
  ).toEqual({
    capacityMeshNodeId: "cmn_47__sub_2_1",
    center: { x: 1, y: 2 },
    width: 3,
    height: 4,
    portPoints: [
      { portPointId: "pp1", x: 1, y: 1, z: 0 },
      { portPointId: "pp2", x: 2, y: 2, z: 1 },
    ],
  })
})

test("getHighDensityNodeDownloadData swallows throwing fallback getters during deep scan", () => {
  const solver = {
    activeSubSolver: {
      getOutput: () => {
        throw new Error("broken serializer")
      },
      nested: {
        getConstructorParams: () => [
          {
            nodeWithPortPoints: [
              {
                capacityMeshNodeId: "cmn_safe",
                center: { x: 9, y: 9 },
                width: 1,
                height: 1,
                portPoints: [{ portPointId: "pp1", x: 9, y: 9, z: 0 }],
              },
            ],
          },
        ],
      },
    },
  } as any

  expect(
    (getHighDensityNodeDownloadData(solver, "cmn_safe") as any)
      .nodeWithPortPoints,
  ).toEqual({
    capacityMeshNodeId: "cmn_safe",
    center: { x: 9, y: 9 },
    width: 1,
    height: 1,
    portPoints: [{ portPointId: "pp1", x: 9, y: 9, z: 0 }],
  })
})
