import {
  type Bounds,
  doBoundsOverlap,
  getBoundFromCenteredRect,
  getBoundingBox,
} from "@tscircuit/math-utils"
import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { BgaTopologyGeneratorSolver } from "lib/solvers/BgaTopologyGeneratorSolver/BgaTopologyGeneratorSolver"
import { QfpThermalPadTopologyGeneratorSolver } from "lib/solvers/QfpThermalPadTopologyGeneratorSolver/QfpThermalPadTopologyGeneratorSolver"
import { QfpTopologyGeneratorSolver } from "lib/solvers/QfpTopologyGeneratorSolver/QfpTopologyGeneratorSolver"
import { SoicTopologyGeneratorSolver } from "lib/solvers/SoicTopologyGeneratorSolver/SoicTopologyGeneratorSolver"
import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"
import { getBoundsForObstacles } from "lib/utils/getBoundsForObstacles"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import type {
  MultiGraphTopologyPlannerSolverParams,
  SerializedTopologyComponentInput,
  TopologyMeshMergeStrategy,
} from "./MultiGraphTopologyPlannerSolver"

export interface NormalizedTopologyPlannerInput {
  globalNoConnectionSrj: SimpleRouteJson
  components: SerializedTopologyComponentInput[]
}

export interface ComponentTopologyBatchSolverParams {
  componentSrjs: SimpleRouteJson[]
  componentIds: string[]
  componentKinds: Array<"bga" | "qfp" | "qfp_thermalpad" | "soic" | undefined>
  replacementObstacleIds: Array<string | undefined>
  viaDiameter?: number
  obstacleMargin?: number
}

export interface ComponentTopologyBatchSolverOutput {
  componentMeshNodes: CapacityMeshNode[][]
}

/**
 * Builds the component-local SRJ passed into BGA topology generation.
 *
 * Important:
 * - component bounds come from the detected member obstacles.
 * - only original SRJ obstacles whose geometry overlaps those bounds are
 *   included in the component-local topology solve.
 * - included obstacle geometry is copied from the original SRJ unchanged.
 * - electrically connected obstacles outside the component bounds remain part
 *   of the global topology, not the component-local BGA matrix.
 */
export function createComponentSrj({
  inputSrj,
  component,
}: {
  inputSrj: SimpleRouteJson
  component: SerializedTopologyComponentInput
}): SimpleRouteJson {
  const obstacleBounds = getBoundsForObstacles(component.memberObstacles)
  const localPointMargin = Math.max(
    inputSrj.minViaPadDiameter ??
      inputSrj.min_via_pad_diameter ??
      inputSrj.minViaDiameter ??
      0.3,
    inputSrj.defaultObstacleMargin ?? 0.15,
    inputSrj.minTraceWidth * 2,
  )
  const memberConnectionIds = new Set(
    component.memberObstacles.flatMap((obstacle) => obstacle.connectedTo),
  )
  const connectedPoints = inputSrj.connections.flatMap((connection) =>
    connection.pointsToConnect.filter((point) => {
      const pointIds = [point.pointId, point.pcb_port_id].filter(
        (pointId): pointId is string => typeof pointId === "string",
      )
      const isConnectedToComponent = pointIds.some((pointId) =>
        memberConnectionIds.has(pointId),
      )
      const isNearComponentBounds =
        point.x >= obstacleBounds.minX - localPointMargin &&
        point.x <= obstacleBounds.maxX + localPointMargin &&
        point.y >= obstacleBounds.minY - localPointMargin &&
        point.y <= obstacleBounds.maxY + localPointMargin

      return isConnectedToComponent && isNearComponentBounds
    }),
  )
  const componentBounds = connectedPoints.reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      maxX: Math.max(bounds.maxX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    obstacleBounds,
  )
  const componentObstacles = inputSrj.obstacles
    .filter((obstacle) =>
      doBoundsOverlap(getBoundingBox(obstacle), componentBounds),
    )
    .map((obstacle) => ({ ...obstacle }))

  return {
    ...structuredClone(inputSrj),
    bounds: componentBounds,
    obstacles: componentObstacles,
  }
}

/** Normalizes the supported input forms into the planner's internal representation. */
export function normalizeInput(
  input: MultiGraphTopologyPlannerSolverParams,
): NormalizedTopologyPlannerInput {
  const globalNoConnectionSrj =
    input.globalNoConnectionSrj ??
    input.componentDetectionOutput?.global ??
    input.brokenSrj?.global
  const components =
    input.components ??
    input.componentDetectionOutput?.components ??
    input.brokenSrj?.components ??
    []

  if (!globalNoConnectionSrj) {
    throw new Error(
      "MultiGraphTopologyPlannerSolver requires globalNoConnectionSrj or componentDetectionOutput.global",
    )
  }

  return {
    globalNoConnectionSrj,
    components,
  }
}

/**
 * Replaces the global component-region node with the finer component-local
 * routing regions.
 */
export function mergeMeshNodes({
  globalMeshNodes,
  components,
  componentMeshNodes,
  mergeStrategy,
  layerCount,
}: {
  globalMeshNodes: CapacityMeshNode[]
  components: SerializedTopologyComponentInput[]
  componentMeshNodes: CapacityMeshNode[][]
  mergeStrategy: TopologyMeshMergeStrategy
  layerCount: number
}): CapacityMeshNode[] {
  switch (mergeStrategy) {
    case "concat":
      return [
        ...globalMeshNodes.filter(
          (node) =>
            !components.some((component) =>
              isReplacementRegionNode({ node, component }),
            ),
        ),
        ...mergeOverlappingComponentMeshNodeSets({
          components,
          componentMeshNodes,
          layerCount,
        }),
      ]
  }
}

/**
 * Removes global RectDiff mesh nodes that are fully covered by component-local
 * replacement areas.
 *
 * @param params.meshNodes - Global RectDiff capacity nodes before component
 *   mesh substitution.
 * @param params.components - Detected topology components whose replacement
 *   obstacles define the component-local routing areas.
 * @returns A filtered mesh node array. Nodes that merely overlap a component
 *   area are preserved; only nodes whose entire rectangle is contained in a
 *   replacement obstacle are removed.
 *
 * @note This is intentionally applied before `mergeMeshNodes` so downstream
 * solvers do not see duplicate global and component-local routing regions.
 * @caution Replacement obstacles are expected to be axis-aligned rectangles.
 */
export function filterMeshNodesInsideComponentAreas({
  meshNodes,
  components,
}: {
  meshNodes: CapacityMeshNode[]
  components: SerializedTopologyComponentInput[]
}): CapacityMeshNode[] {
  if (components.length === 0) return meshNodes

  return meshNodes.filter(
    (meshNode) =>
      !components.some((component) =>
        isMeshNodeFullyInsideObstacle({
          meshNode,
          obstacle: component.replacementObstacle,
        }),
      ),
  )
}

type GraphicsRect = NonNullable<GraphicsObject["rects"]>[number]

/**
 * Removes RectDiff node rectangles from a graphics-debug visualization when
 * those rectangles are fully contained inside component replacement areas.
 *
 * @param params.rects - Visualization rectangles, typically from the nested
 *   RectDiff stage inside topology planning.
 * @param params.components - Detected topology components whose replacement
 *   obstacles define regions that are redrawn by component-local topology.
 * @returns The original `rects` reference when there is nothing to filter;
 *   otherwise a filtered array without covered RectDiff node rectangles.
 *
 * @note Only labels beginning with `"node "` are treated as RectDiff node
 *   rectangles. Component obstacle overlays and merged topology rectangles are
 *   left untouched.
 * @caution This is a visualization-only filter. Keep the mesh-node filter above
 *   in sync when changing containment semantics.
 */
export function filterRectDiffNodeRectsInsideComponentAreas({
  rects,
  components,
}: {
  rects: GraphicsRect[] | undefined
  components: SerializedTopologyComponentInput[]
}): GraphicsRect[] | undefined {
  if (!rects || components.length === 0) return rects

  return rects.filter(
    (rect) =>
      !isRectDiffNodeRect(rect) ||
      !components.some((component) =>
        isRectFullyInsideObstacle({
          rect,
          obstacle: component.replacementObstacle,
        }),
      ),
  )
}

export function mergeNestedComponentMeshNodes({
  components,
  componentMeshNodes,
  componentSrjs,
}: {
  components: SerializedTopologyComponentInput[]
  componentMeshNodes: CapacityMeshNode[][]
  componentSrjs?: SimpleRouteJson[]
}): CapacityMeshNode[][] {
  return componentMeshNodes.map((nodes, componentIndex) => {
    const parentComponent = components[componentIndex]
    if (!parentComponent) return nodes

    const extraObstacleNodes = getExtraComponentLocalObstacleNodes({
      component: parentComponent,
      components,
      componentSrj: componentSrjs?.[componentIndex],
    })
    const nodesWithExtraObstacleClearance = extraObstacleNodes.reduce(
      (splitNodes, obstacleNode) =>
        splitNodes.flatMap((node) =>
          splitNodeAroundObstacleNode({
            node,
            obstacleNode,
          }),
        ),
      nodes,
    )
    return [...nodesWithExtraObstacleClearance, ...extraObstacleNodes]
  })
}

function splitNodeAroundObstacleNode({
  node,
  obstacleNode,
}: {
  node: CapacityMeshNode
  obstacleNode: CapacityMeshNode
}) {
  if (node._containsObstacle) return [node]

  const sharedZ = intersectAvailableZ([
    node.availableZ,
    obstacleNode.availableZ,
  ])
  if (sharedZ.length === 0) return [node]

  const nodeBounds = getNodeBounds(node)
  const obstacleBounds = getNodeBounds(obstacleNode)
  const intersectionBounds = getBoundsIntersection({
    a: nodeBounds,
    b: obstacleBounds,
  })

  if (!intersectionBounds) return [node]

  const splitBounds = [
    {
      key: "top",
      bounds: {
        minX: nodeBounds.minX,
        maxX: nodeBounds.maxX,
        minY: nodeBounds.minY,
        maxY: intersectionBounds.minY,
      },
    },
    {
      key: "right",
      bounds: {
        minX: intersectionBounds.maxX,
        maxX: nodeBounds.maxX,
        minY: intersectionBounds.minY,
        maxY: intersectionBounds.maxY,
      },
    },
    {
      key: "bottom",
      bounds: {
        minX: nodeBounds.minX,
        maxX: nodeBounds.maxX,
        minY: intersectionBounds.maxY,
        maxY: nodeBounds.maxY,
      },
    },
    {
      key: "left",
      bounds: {
        minX: nodeBounds.minX,
        maxX: intersectionBounds.minX,
        minY: intersectionBounds.minY,
        maxY: intersectionBounds.maxY,
      },
    },
  ]
  const remainingZ = node.availableZ
    .filter((z) => !obstacleNode.availableZ.includes(z))
    .sort((a, b) => a - b)
  const splitNodes = splitBounds
    .filter(({ bounds }) => isValidNodeBounds(bounds))
    .map(({ key, bounds }) =>
      createNodeFromBounds({
        node,
        bounds,
        capacityMeshNodeId: `${node.capacityMeshNodeId}:around:${obstacleNode.capacityMeshNodeId}:${key}`,
      }),
    )

  if (remainingZ.length > 0) {
    splitNodes.push(
      createNodeFromBounds({
        node,
        bounds: intersectionBounds,
        capacityMeshNodeId: `${node.capacityMeshNodeId}:under:${obstacleNode.capacityMeshNodeId}`,
        availableZ: remainingZ,
      }),
    )
  }

  return splitNodes
}

function getExtraComponentLocalObstacleNodes({
  component,
  components,
  componentSrj,
}: {
  component: SerializedTopologyComponentInput
  components: SerializedTopologyComponentInput[]
  componentSrj: SimpleRouteJson | undefined
}) {
  if (!componentSrj) return []

  const memberObstacleIds = new Set(component.memberObstacleIds)
  const childComponents = components.filter(
    (candidate) =>
      candidate.componentId !== component.componentId &&
      isObstacleInsideObstacle({
        inner: candidate.replacementObstacle,
        outer: component.replacementObstacle,
      }),
  )
  const replacementBounds = getObstacleBounds(component.replacementObstacle)

  return componentSrj.obstacles.flatMap((obstacle, obstacleIndex) => {
    if (obstacle.componentId === component.componentId) return []
    if (obstacle.obstacleId && memberObstacleIds.has(obstacle.obstacleId)) {
      return []
    }
    if (
      childComponents.some((childComponent) =>
        isObstacleInsideObstacle({
          inner: obstacle,
          outer: childComponent.replacementObstacle,
        }),
      )
    ) {
      return []
    }

    const obstacleBounds = getObstacleBounds(obstacle)
    const bounds = getBoundsIntersection({
      a: obstacleBounds,
      b: replacementBounds,
    })

    if (!bounds) return []

    return [
      createObstacleNodeFromBounds({
        obstacle,
        bounds,
        capacityMeshNodeId: `extra-obstacle:${component.componentId}:${obstacle.obstacleId ?? obstacleIndex}`,
        layerCount: componentSrj.layerCount,
      }),
    ]
  })
}

export function mergeOverlappingMeshNodeRegions(
  nodes: CapacityMeshNode[],
): CapacityMeshNode[] {
  if (nodes.length <= 1) return nodes

  return getOverlappingNodeGroups(nodes).flatMap((group) => {
    if (group.length <= 1) return group
    return mergeOverlappingNodeGroup(group)
  })
}

function mergeOverlappingComponentMeshNodeSets({
  components,
  componentMeshNodes,
  layerCount,
}: {
  components: SerializedTopologyComponentInput[]
  componentMeshNodes: CapacityMeshNode[][]
  layerCount: number
}) {
  const componentIndexGroups = getOverlappingComponentIndexGroups(components)

  return componentIndexGroups.flatMap((componentIndexes) => {
    if (componentIndexes.length === 1) {
      return componentMeshNodes[componentIndexes[0]!] ?? []
    }

    return mergeOverlappingMeshNodeRegionSets(
      componentIndexes.map((componentIndex) => ({
        component: components[componentIndex]!,
        nodes: componentMeshNodes[componentIndex] ?? [],
      })),
      layerCount,
    )
  })
}

function getOverlappingComponentIndexGroups(
  components: SerializedTopologyComponentInput[],
) {
  const groups: number[][] = []
  const visited = new Set<number>()

  for (
    let componentIndex = 0;
    componentIndex < components.length;
    componentIndex++
  ) {
    if (visited.has(componentIndex)) continue

    const group: number[] = []
    const stack = [componentIndex]
    visited.add(componentIndex)

    while (stack.length > 0) {
      const currentIndex = stack.pop()!
      const currentComponent = components[currentIndex]!
      group.push(currentIndex)

      for (
        let candidateIndex = 0;
        candidateIndex < components.length;
        candidateIndex++
      ) {
        if (visited.has(candidateIndex)) continue

        const candidateComponent = components[candidateIndex]!
        if (
          getBoundsIntersection({
            a: getObstacleBounds(currentComponent.replacementObstacle),
            b: getObstacleBounds(candidateComponent.replacementObstacle),
          })
        ) {
          visited.add(candidateIndex)
          stack.push(candidateIndex)
        }
      }
    }

    groups.push(group)
  }

  return groups
}

function mergeOverlappingMeshNodeRegionSets(
  regionSets: Array<{
    component: SerializedTopologyComponentInput
    nodes: CapacityMeshNode[]
  }>,
  layerCount: number,
) {
  const passthroughNodes = regionSets.flatMap((regionSet) =>
    regionSet.nodes.filter((node) => node._containsObstacle),
  )
  const routableRegionSets = regionSets
    .map((regionSet) => ({
      ...regionSet,
      nodes: regionSet.nodes.filter((node) => !node._containsObstacle),
    }))
    .filter((regionSet) => regionSet.nodes.length > 0)
  const nodes = routableRegionSets.flatMap((regionSet) => regionSet.nodes)

  if (nodes.length <= 1) return nodes

  const xEdges = clusterOverlayAxisValues(
    nodes.flatMap((node) => {
      const bounds = getNodeBounds(node)
      return [bounds.minX, bounds.maxX]
    }),
  )
  const yEdges = clusterOverlayAxisValues(
    nodes.flatMap((node) => {
      const bounds = getNodeBounds(node)
      return [bounds.minY, bounds.maxY]
    }),
  )
  const mergedNodes: CapacityMeshNode[] = []

  for (let xIndex = 0; xIndex < xEdges.length - 1; xIndex++) {
    for (let yIndex = 0; yIndex < yEdges.length - 1; yIndex++) {
      const bounds = {
        minX: xEdges[xIndex]!,
        maxX: xEdges[xIndex + 1]!,
        minY: yEdges[yIndex]!,
        maxY: yEdges[yIndex + 1]!,
      }

      if (!isValidNodeBounds(bounds)) continue

      const coveringNodeGroups = routableRegionSets
        .map(({ nodes }) =>
          nodes.filter((node) =>
            isBoundsInsideBounds({
              inner: bounds,
              outer: getNodeBounds(node),
              allowEqualBounds: true,
            }),
          ),
        )
        .filter((coveringNodes) => coveringNodes.length > 0)

      if (coveringNodeGroups.length === 0) continue

      const availableZ = intersectAvailableZ(
        coveringNodeGroups.map((coveringNodes) =>
          unionAvailableZ(coveringNodes.map((node) => node.availableZ)),
        ),
      )

      if (availableZ.length === 0) continue

      const coveringNodes = coveringNodeGroups.flat()
      mergedNodes.push(
        createOverlayNodeFromBounds({
          nodes: coveringNodes,
          bounds,
          xIndex,
          yIndex,
          availableZ,
        }),
      )
    }
  }

  return [...passthroughNodes, ...mergedNodes]
}

function getOverlappingNodeGroups(nodes: CapacityMeshNode[]) {
  const groups: CapacityMeshNode[][] = []
  const visited = new Set<CapacityMeshNode>()

  for (const node of nodes) {
    if (visited.has(node)) continue

    const group: CapacityMeshNode[] = []
    const stack = [node]
    visited.add(node)

    while (stack.length > 0) {
      const currentNode = stack.pop()!
      group.push(currentNode)

      for (const candidate of nodes) {
        if (visited.has(candidate)) continue
        if (
          getBoundsIntersection({
            a: getNodeBounds(currentNode),
            b: getNodeBounds(candidate),
          })
        ) {
          visited.add(candidate)
          stack.push(candidate)
        }
      }
    }

    groups.push(group)
  }

  return groups
}

function mergeOverlappingNodeGroup(nodes: CapacityMeshNode[]) {
  const xEdges = clusterOverlayAxisValues(
    nodes.flatMap((node) => {
      const bounds = getNodeBounds(node)
      return [bounds.minX, bounds.maxX]
    }),
  )
  const yEdges = clusterOverlayAxisValues(
    nodes.flatMap((node) => {
      const bounds = getNodeBounds(node)
      return [bounds.minY, bounds.maxY]
    }),
  )
  const mergedNodes: CapacityMeshNode[] = []

  for (let xIndex = 0; xIndex < xEdges.length - 1; xIndex++) {
    for (let yIndex = 0; yIndex < yEdges.length - 1; yIndex++) {
      const bounds = {
        minX: xEdges[xIndex]!,
        maxX: xEdges[xIndex + 1]!,
        minY: yEdges[yIndex]!,
        maxY: yEdges[yIndex + 1]!,
      }

      if (!isValidNodeBounds(bounds)) continue

      const coveringNodes = nodes.filter((node) =>
        isBoundsInsideBounds({
          inner: bounds,
          outer: getNodeBounds(node),
          allowEqualBounds: true,
        }),
      )

      if (coveringNodes.length === 0) continue

      const availableZ = intersectAvailableZ(
        coveringNodes.map((node) => node.availableZ),
      )

      if (availableZ.length === 0) continue

      mergedNodes.push(
        createOverlayNodeFromBounds({
          nodes: coveringNodes,
          bounds,
          xIndex,
          yIndex,
          availableZ,
        }),
      )
    }
  }

  return mergedNodes
}

function clusterOverlayAxisValues(values: number[]) {
  const epsilon = 1e-9
  const sortedValues = [...values].sort((a, b) => a - b)
  const clusters: number[] = []

  for (const value of sortedValues) {
    const lastValue = clusters.at(-1)
    if (lastValue === undefined || Math.abs(value - lastValue) > epsilon) {
      clusters.push(value)
    }
  }

  return clusters
}

function intersectAvailableZ(zSets: number[][]) {
  if (zSets.length === 0) return []

  return [...new Set(zSets[0])]
    .filter((z) => zSets.every((zSet) => zSet.includes(z)))
    .sort((a, b) => a - b)
}

function unionAvailableZ(zSets: number[][]) {
  return [...new Set(zSets.flat())].sort((a, b) => a - b)
}

function getObstacleAvailableZ(obstacle: Obstacle, layerCount: number) {
  if (obstacle.zLayers && obstacle.zLayers.length > 0) {
    return [...new Set(obstacle.zLayers)].sort((a, b) => a - b)
  }

  return [
    ...new Set(
      obstacle.layers.map((layerName) =>
        mapLayerNameToZ(layerName, layerCount),
      ),
    ),
  ].sort((a, b) => a - b)
}

function restrictObstacleNodeToComponentLayers({
  node,
  component,
  layerCount,
}: {
  node: CapacityMeshNode
  component: SerializedTopologyComponentInput
  layerCount: number
}) {
  const componentZ = getComponentZLayers({ component, layerCount })
  if (componentZ.length === 0) return [node]

  const availableZ = node.availableZ
    .filter((z) => componentZ.includes(z))
    .sort((a, b) => a - b)

  if (availableZ.length === 0) return []
  if (
    availableZ.length === node.availableZ.length &&
    availableZ.every((z, index) => z === node.availableZ[index])
  ) {
    return [node]
  }

  return [
    {
      ...node,
      capacityMeshNodeId:
        availableZ.length === 1
          ? `${node.capacityMeshNodeId}:component-z${availableZ[0]}`
          : `${node.capacityMeshNodeId}:component-z${availableZ.join(",")}`,
      layer: `z${availableZ.join(",")}`,
      availableZ,
    },
  ]
}

function getComponentZLayers({
  component,
  layerCount,
}: {
  component: SerializedTopologyComponentInput
  layerCount: number
}) {
  if (
    component.replacementObstacle.zLayers &&
    component.replacementObstacle.zLayers.length > 0
  ) {
    return [...new Set(component.replacementObstacle.zLayers)].sort(
      (a, b) => a - b,
    )
  }

  return [
    ...new Set(
      component.replacementObstacle.layers.map((layerName) =>
        mapLayerNameToZ(layerName, layerCount),
      ),
    ),
  ].sort((a, b) => a - b)
}

function getBoundsIntersection({
  a,
  b,
}: {
  a: ReturnType<typeof getNodeBounds>
  b: ReturnType<typeof getNodeBounds>
}) {
  const intersection = {
    minX: Math.max(a.minX, b.minX),
    maxX: Math.min(a.maxX, b.maxX),
    minY: Math.max(a.minY, b.minY),
    maxY: Math.min(a.maxY, b.maxY),
  }

  return isValidNodeBounds(intersection) ? intersection : null
}

function getNodeBounds(node: CapacityMeshNode) {
  return {
    minX: node.center.x - node.width / 2,
    maxX: node.center.x + node.width / 2,
    minY: node.center.y - node.height / 2,
    maxY: node.center.y + node.height / 2,
  }
}

function getObstacleBounds(
  obstacle: SerializedTopologyComponentInput["replacementObstacle"],
) {
  return {
    minX: obstacle.center.x - obstacle.width / 2,
    maxX: obstacle.center.x + obstacle.width / 2,
    minY: obstacle.center.y - obstacle.height / 2,
    maxY: obstacle.center.y + obstacle.height / 2,
  }
}

function isObstacleInsideObstacle({
  inner,
  outer,
}: {
  inner: SerializedTopologyComponentInput["replacementObstacle"]
  outer: SerializedTopologyComponentInput["replacementObstacle"]
}) {
  return isBoundsInsideBounds({
    inner: getObstacleBounds(inner),
    outer: getObstacleBounds(outer),
  })
}

function isBoundsInsideBounds({
  inner,
  outer,
  allowEqualBounds = false,
}: {
  inner: ReturnType<typeof getNodeBounds>
  outer: ReturnType<typeof getNodeBounds>
  allowEqualBounds?: boolean
}) {
  const epsilon = 1e-9
  const isInside =
    inner.minX >= outer.minX - epsilon &&
    inner.maxX <= outer.maxX + epsilon &&
    inner.minY >= outer.minY - epsilon &&
    inner.maxY <= outer.maxY + epsilon

  if (allowEqualBounds) return isInside

  return (
    isInside &&
    (inner.minX > outer.minX + epsilon ||
      inner.maxX < outer.maxX - epsilon ||
      inner.minY > outer.minY + epsilon ||
      inner.maxY < outer.maxY - epsilon)
  )
}

function isValidNodeBounds(bounds: ReturnType<typeof getNodeBounds>) {
  const epsilon = 1e-9

  return (
    bounds.maxX - bounds.minX > epsilon && bounds.maxY - bounds.minY > epsilon
  )
}

function getObstacleFromNode(
  node: CapacityMeshNode,
): SerializedTopologyComponentInput["replacementObstacle"] {
  return {
    type: "rect",
    center: node.center,
    width: node.width,
    height: node.height,
    layers: node.layer.split(","),
    zLayers: node.availableZ,
    connectedTo: [],
  }
}

function createOverlayNodeFromBounds({
  nodes,
  bounds,
  xIndex,
  yIndex,
  availableZ,
}: {
  nodes: CapacityMeshNode[]
  bounds: ReturnType<typeof getNodeBounds>
  xIndex: number
  yIndex: number
  availableZ: number[]
}): CapacityMeshNode {
  const primaryNode = nodes.find((node) => node._containsObstacle) ?? nodes[0]!
  const isWholePrimaryNode = areBoundsEqual(bounds, getNodeBounds(primaryNode))
  const capacityMeshNodeId =
    nodes.length === 1 && isWholePrimaryNode
      ? primaryNode.capacityMeshNodeId
      : `overlay:${nodes.map((node) => node.capacityMeshNodeId).join("&")}:cell:${xIndex}:${yIndex}`

  return {
    ...primaryNode,
    capacityMeshNodeId,
    center: {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    },
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
    layer: `z${availableZ.join(",")}`,
    availableZ,
    _containsObstacle: nodes.some((node) => node._containsObstacle),
    _isNarrowQfpPadGap: nodes.some((node) => node._isNarrowQfpPadGap),
  }
}

function createNodeFromBounds({
  node,
  bounds,
  capacityMeshNodeId,
  availableZ = node.availableZ,
}: {
  node: CapacityMeshNode
  bounds: ReturnType<typeof getNodeBounds>
  capacityMeshNodeId: string
  availableZ?: number[]
}): CapacityMeshNode {
  return {
    ...node,
    capacityMeshNodeId,
    center: {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    },
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
    layer: `z${availableZ.join(",")}`,
    availableZ,
  }
}

function createObstacleNodeFromBounds({
  obstacle,
  bounds,
  capacityMeshNodeId,
  layerCount,
}: {
  obstacle: Obstacle
  bounds: ReturnType<typeof getNodeBounds>
  capacityMeshNodeId: string
  layerCount: number
}): CapacityMeshNode {
  const availableZ = getObstacleAvailableZ(obstacle, layerCount)

  return {
    capacityMeshNodeId,
    center: {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    },
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
    layer: `z${availableZ.join(",")}`,
    availableZ,
    _containsObstacle: true,
  }
}

function areBoundsEqual(
  a: ReturnType<typeof getNodeBounds>,
  b: ReturnType<typeof getNodeBounds>,
) {
  const epsilon = 1e-9

  return (
    Math.abs(a.minX - b.minX) <= epsilon &&
    Math.abs(a.maxX - b.maxX) <= epsilon &&
    Math.abs(a.minY - b.minY) <= epsilon &&
    Math.abs(a.maxY - b.maxY) <= epsilon
  )
}

/** Matches a global routing region against a detected component replacement obstacle. */
function isReplacementRegionNode({
  node,
  component,
}: {
  node: CapacityMeshNode
  component: SerializedTopologyComponentInput
}) {
  const { replacementObstacle } = component
  const epsilon = 1e-9
  const isExactReplacementNode =
    Math.abs(node.center.x - replacementObstacle.center.x) <= epsilon &&
    Math.abs(node.center.y - replacementObstacle.center.y) <= epsilon &&
    Math.abs(node.width - replacementObstacle.width) <= epsilon &&
    Math.abs(node.height - replacementObstacle.height) <= epsilon

  if (
    component.componentKind !== "qfp" &&
    component.componentKind !== "qfp_thermalpad" &&
    component.componentKind !== "soic"
  ) {
    return isExactReplacementNode
  }

  const replacementMinX =
    replacementObstacle.center.x - replacementObstacle.width / 2
  const replacementMaxX =
    replacementObstacle.center.x + replacementObstacle.width / 2
  const replacementMinY =
    replacementObstacle.center.y - replacementObstacle.height / 2
  const replacementMaxY =
    replacementObstacle.center.y + replacementObstacle.height / 2
  const nodeCenterInsideReplacement =
    node.center.x >= replacementMinX - epsilon &&
    node.center.x <= replacementMaxX + epsilon &&
    node.center.y >= replacementMinY - epsilon &&
    node.center.y <= replacementMaxY + epsilon

  return nodeCenterInsideReplacement || isExactReplacementNode
}

/**
 * Detects whether a graphics rectangle came from RectDiff's node renderer.
 *
 * @param rect - A graphics-debug rectangle from a combined visualization.
 * @returns `true` when the rectangle label follows RectDiff's `"node ..."`
 *   label convention; otherwise `false`.
 *
 * @note This label check prevents the visualization filter from removing
 * component pads, obstacle overlays, or merged topology rectangles.
 */
function isRectDiffNodeRect(rect: GraphicsRect) {
  return typeof rect.label === "string" && rect.label.startsWith("node ")
}

/**
 * Checks whether a capacity mesh node is fully contained by a component
 * replacement obstacle.
 *
 * @param params.meshNode - Capacity mesh node represented as a centered
 *   rectangle.
 * @param params.obstacle - Component replacement obstacle used as the containing
 *   rectangle.
 * @returns `true` when the node rectangle is fully inside the obstacle bounds;
 *   otherwise `false`.
 */
function isMeshNodeFullyInsideObstacle({
  meshNode,
  obstacle,
}: {
  meshNode: CapacityMeshNode
  obstacle: Obstacle
}) {
  return isRectFullyInsideObstacle({
    rect: {
      center: meshNode.center,
      width: meshNode.width,
      height: meshNode.height,
    },
    obstacle,
  })
}

/**
 * Checks whether a centered rectangle is fully contained by a replacement
 * obstacle.
 *
 * @param params.rect - Candidate rectangle with `center`, `width`, and
 *   `height`; incomplete rectangles return `false`.
 * @param params.obstacle - Axis-aligned obstacle that may contain `rect`.
 * @returns `true` when the rectangle's computed bounds are fully inside the
 *   obstacle's computed bounds; otherwise `false`.
 *
 * @note Uses `getBoundFromCenteredRect` from `@tscircuit/math-utils` to avoid
 * hand-rolled centered-rectangle bound construction.
 */
function isRectFullyInsideObstacle({
  rect,
  obstacle,
}: {
  rect: {
    center?: { x: number; y: number }
    width?: number
    height?: number
  }
  obstacle: Obstacle
}) {
  if (!rect.center || rect.width === undefined || rect.height === undefined) {
    return false
  }

  const epsilon = 1e-9
  const rectBounds = getBoundFromCenteredRect({
    center: rect.center,
    width: rect.width,
    height: rect.height,
  })
  const obstacleBounds = getBoundFromCenteredRect({
    center: obstacle.center,
    width: obstacle.width,
    height: obstacle.height,
  })

  return areBoundsInsideBounds({
    bounds: rectBounds,
    outerBounds: obstacleBounds,
    epsilon,
  })
}

/**
 * Checks whether one axis-aligned bounds rectangle is fully contained by
 * another bounds rectangle.
 *
 * @param params.bounds - Inner bounds expected to be contained.
 * @param params.outerBounds - Outer bounds that may contain `bounds`.
 * @param params.epsilon - Numeric tolerance applied to each edge comparison.
 * @returns `true` when every edge of `bounds` is inside `outerBounds`, allowing
 *   the supplied epsilon; otherwise `false`.
 *
 * @note `@tscircuit/math-utils` currently provides overlap/intersection
 * helpers, while full bounds containment still needs explicit edge comparison.
 */
function areBoundsInsideBounds({
  bounds,
  outerBounds,
  epsilon,
}: {
  bounds: Bounds
  outerBounds: Bounds
  epsilon: number
}) {
  return (
    bounds.minX >= outerBounds.minX - epsilon &&
    bounds.maxX <= outerBounds.maxX + epsilon &&
    bounds.minY >= outerBounds.minY - epsilon &&
    bounds.maxY <= outerBounds.maxY + epsilon
  )
}

/** Runs one component-local topology solve per component SRJ and collects the routing regions. */
export class ComponentTopologyBatchSolver extends BaseSolver {
  activeSubSolver?:
    | BgaTopologyGeneratorSolver
    | QfpTopologyGeneratorSolver
    | QfpThermalPadTopologyGeneratorSolver
    | SoicTopologyGeneratorSolver
    | null = null
  currentIndex = 0
  componentMeshNodes: CapacityMeshNode[][] = []

  constructor(
    public readonly inputProblem: ComponentTopologyBatchSolverParams,
  ) {
    super()
  }

  override getConstructorParams() {
    return [this.inputProblem] as const
  }

  /** Steps through component solves sequentially to keep solver state simple and explicit. */
  override _step() {
    if (this.activeSubSolver) {
      this.activeSubSolver.step()

      if (this.activeSubSolver.failed) {
        this.error = this.activeSubSolver.error
        this.failed = true
        this.activeSubSolver = null
        return
      }

      if (!this.activeSubSolver.solved) return

      this.componentMeshNodes.push(
        this.activeSubSolver.getOutput().routingRegions,
      )
      this.currentIndex += 1
      this.activeSubSolver = null
      return
    }

    if (this.currentIndex >= this.inputProblem.componentSrjs.length) {
      this.solved = true
      return
    }

    const componentKind =
      this.inputProblem.componentKinds[this.currentIndex] ?? "bga"
    const solverInput = {
      inputSrj: this.inputProblem.componentSrjs[this.currentIndex]!,
      componentId: this.inputProblem.componentIds[this.currentIndex],
      replacementObstacleId:
        this.inputProblem.replacementObstacleIds[this.currentIndex],
    }

    if (componentKind === "qfp") {
      this.activeSubSolver = new QfpTopologyGeneratorSolver({
        ...solverInput,
        viaDiameter: this.inputProblem.viaDiameter,
        obstacleMargin: this.inputProblem.obstacleMargin,
      })
      return
    }

    if (componentKind === "qfp_thermalpad") {
      this.activeSubSolver = new QfpThermalPadTopologyGeneratorSolver({
        ...solverInput,
        viaDiameter: this.inputProblem.viaDiameter,
        obstacleMargin: this.inputProblem.obstacleMargin,
      })
      return
    }

    if (componentKind === "soic") {
      this.activeSubSolver = new SoicTopologyGeneratorSolver({
        ...solverInput,
        viaDiameter: this.inputProblem.viaDiameter,
        obstacleMargin: this.inputProblem.obstacleMargin,
      })
      return
    }

    this.activeSubSolver = new BgaTopologyGeneratorSolver(solverInput)
  }

  getOutput(): ComponentTopologyBatchSolverOutput {
    return {
      componentMeshNodes: this.componentMeshNodes,
    }
  }
}
