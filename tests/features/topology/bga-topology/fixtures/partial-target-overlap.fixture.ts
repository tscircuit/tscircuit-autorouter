import type { Bounds } from "@tscircuit/math-utils"
import type { GraphicsObject } from "graphics-debug"
import {
  getBoundsIntersection,
  getCapacityMeshNodeBounds,
} from "lib/solvers/TopologyPlanningSolver/capacity-node-geometry"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import type { CapacityMeshNode } from "lib/types"

const CONNECTION_NAME = "source_trace_3__source_net_3_mst8"
const ROOT_CONNECTION_NAMES = ["source_trace_3", "source_net_3"]
const VIA_DIAMETER = 0.33
const TOP_TARGET_BOUNDS = {
  minX: 0.973,
  maxX: 1.227,
  minY: -3.027,
  maxY: -2.773,
}
const BOTTOM_TARGET_BOUNDS = {
  minX: 0.975,
  maxX: 1.565,
  minY: -3.22,
  maxY: -2.58,
}
const LOCAL_VIEW_BOUNDS = {
  minX: 0.82,
  maxX: 1.72,
  minY: -3.37,
  maxY: -2.43,
}
const COMPONENT_FREE_BOUNDS = [
  {
    minX: 1.227,
    maxX: 1.623,
    minY: -3.027,
    maxY: -2.773,
  },
  {
    minX: 0.973,
    maxX: 1.227,
    minY: -3.423,
    maxY: -3.027,
  },
  {
    minX: 0.973,
    maxX: 1.227,
    minY: -2.773,
    maxY: -2.377,
  },
  {
    minX: 1.227,
    maxX: 1.623,
    minY: -3.423,
    maxY: -3.027,
  },
  {
    minX: 1.227,
    maxX: 1.623,
    minY: -2.773,
    maxY: -2.377,
  },
]

const COLORS = {
  backgroundFill: "rgba(90,100,115,0.06)",
  backgroundStroke: "rgba(80,90,105,0.42)",
  componentFreeFill: "rgba(40,155,210,0.14)",
  componentFreeStroke: "rgba(20,110,170,0.62)",
  topFill: "rgba(225,45,45,0.28)",
  topStroke: "rgba(175,20,20,0.92)",
  bottomFill: "rgba(55,95,220,0.22)",
  bottomStroke: "rgba(35,65,175,0.88)",
  accessFill: "rgba(35,175,90,0.3)",
  accessStroke: "rgba(15,125,60,0.96)",
}

function createNodeFromBounds({
  id,
  bounds,
  availableZ,
  metadata = {},
}: {
  id: string
  bounds: Bounds
  availableZ: number[]
  metadata?: Partial<CapacityMeshNode>
}): CapacityMeshNode {
  return {
    capacityMeshNodeId: id,
    center: {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    },
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
    availableZ,
    layer: `z${availableZ.join(",")}`,
    ...metadata,
  }
}

function createGlobalNodes(): CapacityMeshNode[] {
  return [
    createNodeFromBounds({
      id: "cmn_2022",
      bounds: {
        minX: -4.227,
        maxX: 3.827,
        minY: -8.877,
        maxY: -0.823,
      },
      availableZ: [0, 1, 2, 3, 4, 5],
    }),
    createNodeFromBounds({
      id: "cmn_1672",
      bounds: BOTTOM_TARGET_BOUNDS,
      availableZ: [5],
      metadata: {
        _containsObstacle: true,
        _containsTarget: true,
        _targetConnectionName: CONNECTION_NAME,
        _connectedTo: [...ROOT_CONNECTION_NAMES],
      },
    }),
  ]
}

function createComponentNodes(): CapacityMeshNode[] {
  const freeNodes = COMPONENT_FREE_BOUNDS.flatMap((bounds, boundsIndex) =>
    [0, 1, 2, 3, 4].map((z) =>
      createNodeFromBounds({
        id: `component-free-${boundsIndex}-z${z}`,
        bounds,
        availableZ: [z],
      }),
    ),
  )
  return [
    ...freeNodes,
    createNodeFromBounds({
      id: "obstacle-pcb_component_9-port-190",
      bounds: TOP_TARGET_BOUNDS,
      availableZ: [0],
      metadata: {
        _containsObstacle: true,
        _containsTarget: true,
        _targetConnectionName: ROOT_CONNECTION_NAMES[0],
        _connectedTo: [...ROOT_CONNECTION_NAMES],
      },
    }),
  ]
}

function createInputGraphics(): GraphicsObject {
  return {
    rects: [
      {
        center: { x: 1.27, y: -2.9 },
        width: LOCAL_VIEW_BOUNDS.maxX - LOCAL_VIEW_BOUNDS.minX,
        height: LOCAL_VIEW_BOUNDS.maxY - LOCAL_VIEW_BOUNDS.minY,
        fill: COLORS.backgroundFill,
        stroke: COLORS.backgroundStroke,
        label: "global free background z0-z5 (local view)",
      },
      ...COMPONENT_FREE_BOUNDS.map((bounds) => ({
        center: {
          x: (bounds.minX + bounds.maxX) / 2,
          y: (bounds.minY + bounds.maxY) / 2,
        },
        width: bounds.maxX - bounds.minX,
        height: bounds.maxY - bounds.minY,
        fill: COLORS.componentFreeFill,
        stroke: COLORS.componentFreeStroke,
        label: "component free corridor z0-z4",
      })),
      {
        center: { x: 1.27, y: -2.9 },
        width: 0.59,
        height: 0.64,
        fill: COLORS.bottomFill,
        stroke: COLORS.bottomStroke,
        label: "bottom target z5",
      },
      {
        center: { x: 1.1, y: -2.9 },
        width: 0.254,
        height: 0.254,
        fill: COLORS.topFill,
        stroke: COLORS.topStroke,
        label: "top target z0",
      },
    ],
    texts: [
      {
        x: 1.27,
        y: -2.36,
        text: "Same physical XY scale (mm)",
        anchorSide: "bottom_center",
        fontSize: 0.055,
      },
      {
        x: 1.27,
        y: -3.45,
        text: "Red z0 · blue z5 · cyan free z0-z4",
        anchorSide: "top_center",
        fontSize: 0.05,
      },
    ],
  }
}

function createOutputGraphics({
  outputNodes,
  accessRegions,
}: {
  outputNodes: CapacityMeshNode[]
  accessRegions: CapacityMeshNode[]
}): GraphicsObject {
  const accessRegionIds = new Set(
    accessRegions.map((node) => node.capacityMeshNodeId),
  )
  const relevantNodes = outputNodes
    .filter(
      (node) =>
        getBoundsIntersection(
          getCapacityMeshNodeBounds(node),
          BOTTOM_TARGET_BOUNDS,
        ) !== null,
    )
    .sort(
      (left, right) =>
        Number(left._containsTarget) - Number(right._containsTarget) ||
        left.availableZ.length - right.availableZ.length,
    )

  return {
    rects: [
      ...relevantNodes.map((node) => {
        const isAccess = accessRegionIds.has(node.capacityMeshNodeId)
        const isTopTarget =
          node._containsTarget === true && node.availableZ.includes(0)
        const isBottomTarget =
          node._containsTarget === true && node.availableZ.includes(5)
        return {
          center: node.center,
          width: node.width,
          height: node.height,
          fill: isAccess
            ? COLORS.accessFill
            : isTopTarget
              ? COLORS.topFill
              : isBottomTarget
                ? COLORS.bottomFill
                : COLORS.componentFreeFill,
          stroke: isAccess
            ? COLORS.accessStroke
            : isTopTarget
              ? COLORS.topStroke
              : isBottomTarget
                ? COLORS.bottomStroke
                : COLORS.componentFreeStroke,
          strokeWidth: isAccess ? 0.012 : 0.006,
          label: `${node.capacityMeshNodeId}\navailableZ: ${node.availableZ.join(",")}`,
        }
      }),
      {
        center: { x: 1.27, y: -2.9 },
        width: 0.59,
        height: 0.64,
        fill: "rgba(0,0,0,0)",
        stroke: COLORS.bottomStroke,
        strokeWidth: 0.01,
        label: "physical bottom target boundary",
      },
    ],
    circles: accessRegions.map((node) => ({
      center: node.center,
      radius: VIA_DIAMETER / 2,
      fill: "rgba(35,175,90,0.08)",
      stroke: COLORS.accessStroke,
      label: `${VIA_DIAMETER.toFixed(2)} mm via fits`,
    })),
    texts: [
      {
        x: 1.27,
        y: -2.36,
        text: "Same physical XY scale (mm)",
        anchorSide: "bottom_center",
        fontSize: 0.055,
      },
      {
        x: 1.27,
        y: -3.45,
        text:
          accessRegions.length > 0
            ? "Green z0/z5 region · circle Ø0.33 via"
            : "Missing: no Ø0.33 z0/z5 region",
        anchorSide: "top_center",
        fontSize: 0.05,
      },
    ],
  }
}

export function createPartialTargetOverlapFixture() {
  const topologySolver = new TopologyMergingSolver({
    layerCount: 6,
    viaDiameter: VIA_DIAMETER,
    nodeGroups: [
      {
        groupId: "global",
        isComponent: false,
        nodes: createGlobalNodes(),
      },
      {
        groupId: "component-3",
        isComponent: true,
        nodes: createComponentNodes(),
      },
    ],
  })
  topologySolver.solve()
  if (topologySolver.failed) {
    throw new Error(topologySolver.error ?? "Topology merging failed")
  }

  const outputNodes = topologySolver.getOutput()
  const accessRegions = outputNodes.filter(
    (node) =>
      node._containsTarget === true &&
      node.availableZ.includes(0) &&
      node.availableZ.includes(5) &&
      node.width >= VIA_DIAMETER - 1e-6 &&
      node.height >= VIA_DIAMETER - 1e-6 &&
      getBoundsIntersection(
        getCapacityMeshNodeBounds(node),
        BOTTOM_TARGET_BOUNDS,
      ) !== null,
  )

  return {
    accessRegions,
    inputGraphics: createInputGraphics(),
    outputGraphics: createOutputGraphics({ outputNodes, accessRegions }),
  }
}
