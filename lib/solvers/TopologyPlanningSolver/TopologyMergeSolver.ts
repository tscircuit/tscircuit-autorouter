import type { Bounds } from "@tscircuit/math-utils"
import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject, Rect, Text } from "graphics-debug"
import type { CapacityMeshNode } from "lib/types"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import type { SerializedTopologyComponentInput } from "./MultiGraphTopologyPlannerSolver"
import {
  GEOMETRY_EPSILON,
  getBoundsIntersection,
  getCapacityMeshNodeBounds,
  isNodeCenterInsideObstacle,
  isValidCapacityBounds,
} from "./capacity-node-geometry"
import { getGlobalMeshNodesForMergedTopology } from "./get-global-mesh-nodes-for-merged-topology"

type TopologyInterfaceCandidate = {
  bounds: Bounds
  availableZ: number[]
  sourceNodeIds: string[]
}

type LayeredNodeFragment = {
  bounds: Bounds
  availableZ: number[]
  suffix: string
}

type ClippedCutout = {
  bounds: Bounds
  node: CapacityMeshNode
}

type TopologyNodeRole = "global" | "component" | "interface"

type TopologyDomain = {
  domainId: string
  role: "global" | "component"
  componentId: string
  nodes: CapacityMeshNode[]
}

const TOPOLOGY_OVERLAP_TOLERANCE = 1e-5

export interface TopologyMergeSolverParams {
  globalMeshNodes: CapacityMeshNode[]
  components: SerializedTopologyComponentInput[]
  componentMeshNodes: CapacityMeshNode[][]
  layerCount: number
  viaDiameter?: number
}

export interface TopologyMergeSolverOutput {
  globalMeshNodes: CapacityMeshNode[]
  componentMeshNodes: CapacityMeshNode[][]
  topologyInterfaceMeshNodes: CapacityMeshNode[]
  mergedMeshNodes: CapacityMeshNode[]
}

function getSortedUniqueZ(values: number[]): number[] {
  return [...new Set(values)].sort((a: number, b: number) => a - b)
}

function getSortedUniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort()
}

function areZSetsEqual(firstZ: number[], secondZ: number[]): boolean {
  if (firstZ.length !== secondZ.length) return false

  const secondZSet = new Set(secondZ)
  for (const z of firstZ) {
    if (!secondZSet.has(z)) return false
  }

  return true
}

function getSharedZ(
  firstNode: CapacityMeshNode,
  secondNode: CapacityMeshNode,
): number[] {
  const secondZ = new Set(secondNode.availableZ)
  return getSortedUniqueZ(
    firstNode.availableZ.filter((z: number) => secondZ.has(z)),
  )
}

function getUnionZ(
  firstNode: CapacityMeshNode,
  secondNode: CapacityMeshNode,
): number[] {
  return getSortedUniqueZ([...firstNode.availableZ, ...secondNode.availableZ])
}

function getBoundsWidth(bounds: Bounds): number {
  return bounds.maxX - bounds.minX
}

function getBoundsHeight(bounds: Bounds): number {
  return bounds.maxY - bounds.minY
}

function getBoundsCenter(bounds: Bounds): { x: number; y: number } {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  }
}

function createBoundsNode({
  bounds,
  capacityMeshNodeId,
  availableZ,
  role,
  componentId,
  sourceNodeIds,
}: {
  bounds: Bounds
  capacityMeshNodeId: string
  availableZ: number[]
  role: TopologyNodeRole
  componentId: string
  sourceNodeIds: string[]
}): CapacityMeshNode {
  return {
    capacityMeshNodeId,
    center: {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    },
    width: getBoundsWidth(bounds),
    height: getBoundsHeight(bounds),
    layer: `z${availableZ.join(",")}`,
    availableZ,
    _topologyMergeRole: role,
    _topologyMergeComponentId: componentId,
    _topologyMergeSourceNodeIds: sourceNodeIds,
  }
}

function shouldPreserveGlobalNodeAsCutout(node: CapacityMeshNode): boolean {
  return Boolean(node._containsObstacle || node._containsTarget)
}

function isRoutingNode(node: CapacityMeshNode): boolean {
  return !node._containsObstacle
}

function canHostVia({
  bounds,
  viaDiameter,
}: {
  bounds: Bounds
  viaDiameter: number | undefined
}): boolean {
  if (!viaDiameter || viaDiameter <= GEOMETRY_EPSILON) {
    return false
  }

  return (
    getBoundsWidth(bounds) + GEOMETRY_EPSILON >= viaDiameter &&
    getBoundsHeight(bounds) + GEOMETRY_EPSILON >= viaDiameter
  )
}

function getTouchingViaInterfaceBounds({
  globalNode,
  componentNode,
  viaDiameter,
}: {
  globalNode: CapacityMeshNode
  componentNode: CapacityMeshNode
  viaDiameter: number | undefined
}): Bounds | null {
  if (!viaDiameter || viaDiameter <= GEOMETRY_EPSILON) return null

  const globalBounds = getCapacityMeshNodeBounds(globalNode)
  const componentBounds = getCapacityMeshNodeBounds(componentNode)
  const halfViaDiameter = viaDiameter / 2
  const yMin = Math.max(globalBounds.minY, componentBounds.minY)
  const yMax = Math.min(globalBounds.maxY, componentBounds.maxY)
  const xMin = Math.max(globalBounds.minX, componentBounds.minX)
  const xMax = Math.min(globalBounds.maxX, componentBounds.maxX)

  if (yMax - yMin >= viaDiameter) {
    if (
      Math.abs(globalBounds.maxX - componentBounds.minX) <= GEOMETRY_EPSILON
    ) {
      if (
        globalNode.width + GEOMETRY_EPSILON < halfViaDiameter ||
        componentNode.width + GEOMETRY_EPSILON < halfViaDiameter
      ) {
        return null
      }

      return {
        minX: globalBounds.maxX - halfViaDiameter,
        maxX: globalBounds.maxX + halfViaDiameter,
        minY: yMin,
        maxY: yMax,
      }
    }

    if (
      Math.abs(componentBounds.maxX - globalBounds.minX) <= GEOMETRY_EPSILON
    ) {
      if (
        globalNode.width + GEOMETRY_EPSILON < halfViaDiameter ||
        componentNode.width + GEOMETRY_EPSILON < halfViaDiameter
      ) {
        return null
      }

      return {
        minX: globalBounds.minX - halfViaDiameter,
        maxX: globalBounds.minX + halfViaDiameter,
        minY: yMin,
        maxY: yMax,
      }
    }
  }

  if (xMax - xMin >= viaDiameter) {
    if (
      Math.abs(globalBounds.maxY - componentBounds.minY) <= GEOMETRY_EPSILON
    ) {
      if (
        globalNode.height + GEOMETRY_EPSILON < halfViaDiameter ||
        componentNode.height + GEOMETRY_EPSILON < halfViaDiameter
      ) {
        return null
      }

      return {
        minX: xMin,
        maxX: xMax,
        minY: globalBounds.maxY - halfViaDiameter,
        maxY: globalBounds.maxY + halfViaDiameter,
      }
    }

    if (
      Math.abs(componentBounds.maxY - globalBounds.minY) <= GEOMETRY_EPSILON
    ) {
      if (
        globalNode.height + GEOMETRY_EPSILON < halfViaDiameter ||
        componentNode.height + GEOMETRY_EPSILON < halfViaDiameter
      ) {
        return null
      }

      return {
        minX: xMin,
        maxX: xMax,
        minY: globalBounds.minY - halfViaDiameter,
        maxY: globalBounds.minY + halfViaDiameter,
      }
    }
  }

  return null
}

function getTopologyInterfaceCandidate({
  globalNode,
  componentNode,
  viaDiameter,
}: {
  globalNode: CapacityMeshNode
  componentNode: CapacityMeshNode
  viaDiameter: number | undefined
}): TopologyInterfaceCandidate | null {
  const sharedZ = getSharedZ(globalNode, componentNode)
  const overlapBounds = getBoundsIntersection(
    getCapacityMeshNodeBounds(globalNode),
    getCapacityMeshNodeBounds(componentNode),
  )

  if (overlapBounds) {
    const requiresVia = sharedZ.length === 0
    if (
      requiresVia &&
      !canHostVia({
        bounds: overlapBounds,
        viaDiameter,
      })
    ) {
      return null
    }

    return {
      bounds: overlapBounds,
      availableZ: requiresVia ? getUnionZ(globalNode, componentNode) : sharedZ,
      sourceNodeIds: [
        globalNode.capacityMeshNodeId,
        componentNode.capacityMeshNodeId,
      ],
    }
  }

  if (sharedZ.length > 0) return null

  const touchingViaBounds = getTouchingViaInterfaceBounds({
    globalNode,
    componentNode,
    viaDiameter,
  })
  if (!touchingViaBounds || !isValidCapacityBounds(touchingViaBounds)) {
    return null
  }

  return {
    bounds: touchingViaBounds,
    availableZ: getUnionZ(globalNode, componentNode),
    sourceNodeIds: [
      globalNode.capacityMeshNodeId,
      componentNode.capacityMeshNodeId,
    ],
  }
}

function addSortedCutCoordinate(
  coordinates: number[],
  coordinate: number,
): void {
  if (!Number.isFinite(coordinate)) return

  if (
    coordinates.some(
      (existingCoordinate: number) =>
        Math.abs(existingCoordinate - coordinate) <= GEOMETRY_EPSILON,
    )
  ) {
    return
  }

  coordinates.push(coordinate)
  coordinates.sort((a: number, b: number) => a - b)
}

function getClippedCutoutBounds({
  nodeBounds,
  cutoutNode,
}: {
  nodeBounds: Bounds
  cutoutNode: CapacityMeshNode
}): Bounds | null {
  return getBoundsIntersection(
    nodeBounds,
    getCapacityMeshNodeBounds(cutoutNode),
  )
}

function isCellCoveredByCutout({
  cellBounds,
  cutoutBounds,
}: {
  cellBounds: Bounds
  cutoutBounds: Bounds
}): boolean {
  const intersection = getBoundsIntersection(cellBounds, cutoutBounds)
  if (!intersection) return false

  return (
    getBoundsWidth(intersection) >=
      getBoundsWidth(cellBounds) - GEOMETRY_EPSILON &&
    getBoundsHeight(intersection) >=
      getBoundsHeight(cellBounds) - GEOMETRY_EPSILON
  )
}

function subtractLayeredCutoutFromFragment({
  fragment,
  cutoutNode,
  cutoutIndex,
}: {
  fragment: LayeredNodeFragment
  cutoutNode: CapacityMeshNode
  cutoutIndex: number
}): LayeredNodeFragment[] {
  const intersection = getBoundsIntersection(
    fragment.bounds,
    getCapacityMeshNodeBounds(cutoutNode),
  )
  if (!intersection) return [fragment]

  const cutoutZ = new Set(cutoutNode.availableZ)
  const overlappingZ = fragment.availableZ.filter((z: number) => cutoutZ.has(z))
  if (overlappingZ.length === 0) return [fragment]

  const candidateFragments: LayeredNodeFragment[] = [
    {
      bounds: {
        minX: fragment.bounds.minX,
        maxX: fragment.bounds.maxX,
        minY: fragment.bounds.minY,
        maxY: intersection.minY,
      },
      availableZ: fragment.availableZ,
      suffix: `${fragment.suffix}__cut_${cutoutIndex}_top`,
    },
    {
      bounds: {
        minX: fragment.bounds.minX,
        maxX: fragment.bounds.maxX,
        minY: intersection.maxY,
        maxY: fragment.bounds.maxY,
      },
      availableZ: fragment.availableZ,
      suffix: `${fragment.suffix}__cut_${cutoutIndex}_bottom`,
    },
    {
      bounds: {
        minX: fragment.bounds.minX,
        maxX: intersection.minX,
        minY: intersection.minY,
        maxY: intersection.maxY,
      },
      availableZ: fragment.availableZ,
      suffix: `${fragment.suffix}__cut_${cutoutIndex}_left`,
    },
    {
      bounds: {
        minX: intersection.maxX,
        maxX: fragment.bounds.maxX,
        minY: intersection.minY,
        maxY: intersection.maxY,
      },
      availableZ: fragment.availableZ,
      suffix: `${fragment.suffix}__cut_${cutoutIndex}_right`,
    },
  ]
  const remainingInsideZ = fragment.availableZ.filter(
    (z: number) => !cutoutZ.has(z),
  )

  if (remainingInsideZ.length > 0) {
    candidateFragments.push({
      bounds: intersection,
      availableZ: remainingInsideZ,
      suffix: `${fragment.suffix}__cut_${cutoutIndex}_layer_remainder`,
    })
  }

  return candidateFragments.filter((candidate: LayeredNodeFragment): boolean =>
    isValidCapacityBounds(candidate.bounds),
  )
}

function createLayeredFragmentsAroundCutouts({
  node,
  cutoutNodes,
}: {
  node: CapacityMeshNode
  cutoutNodes: CapacityMeshNode[]
}): LayeredNodeFragment[] {
  let fragments: LayeredNodeFragment[] = [
    {
      bounds: getCapacityMeshNodeBounds(node),
      availableZ: getSortedUniqueZ(node.availableZ),
      suffix: "",
    },
  ]

  for (let cutoutIndex = 0; cutoutIndex < cutoutNodes.length; cutoutIndex++) {
    const cutoutNode = cutoutNodes[cutoutIndex]!
    fragments = fragments.flatMap((fragment: LayeredNodeFragment) =>
      subtractLayeredCutoutFromFragment({
        fragment,
        cutoutNode,
        cutoutIndex,
      }),
    )
  }

  return fragments
}

function createPlanarFragmentsAroundCutouts({
  node,
  cutoutNodes,
}: {
  node: CapacityMeshNode
  cutoutNodes: CapacityMeshNode[]
}): LayeredNodeFragment[] {
  const nodeBounds = getCapacityMeshNodeBounds(node)
  const clippedCutouts = cutoutNodes
    .map((cutoutNode: CapacityMeshNode): ClippedCutout | null => {
      const cutoutBounds = getClippedCutoutBounds({ nodeBounds, cutoutNode })
      if (!cutoutBounds) return null

      return { bounds: cutoutBounds, node: cutoutNode }
    })
    .filter(
      (clippedCutout: ClippedCutout | null): clippedCutout is ClippedCutout =>
        clippedCutout !== null,
    )

  if (clippedCutouts.length === 0) {
    return [
      {
        bounds: nodeBounds,
        availableZ: getSortedUniqueZ(node.availableZ),
        suffix: "",
      },
    ]
  }

  const xCuts = [nodeBounds.minX, nodeBounds.maxX]
  const yCuts = [nodeBounds.minY, nodeBounds.maxY]

  for (const clippedCutout of clippedCutouts) {
    addSortedCutCoordinate(xCuts, clippedCutout.bounds.minX)
    addSortedCutCoordinate(xCuts, clippedCutout.bounds.maxX)
    addSortedCutCoordinate(yCuts, clippedCutout.bounds.minY)
    addSortedCutCoordinate(yCuts, clippedCutout.bounds.maxY)
  }

  const fragments: LayeredNodeFragment[] = []
  for (let xIndex = 0; xIndex < xCuts.length - 1; xIndex++) {
    for (let yIndex = 0; yIndex < yCuts.length - 1; yIndex++) {
      const cellBounds: Bounds = {
        minX: xCuts[xIndex]!,
        maxX: xCuts[xIndex + 1]!,
        minY: yCuts[yIndex]!,
        maxY: yCuts[yIndex + 1]!,
      }
      if (!isValidCapacityBounds(cellBounds)) continue

      let cellAvailableZ = getSortedUniqueZ(node.availableZ)
      let coveredByInterfaceCutout = false
      for (const clippedCutout of clippedCutouts) {
        if (
          !isCellCoveredByCutout({
            cellBounds,
            cutoutBounds: clippedCutout.bounds,
          })
        ) {
          continue
        }
        if (clippedCutout.node._topologyMergeRole === "interface") {
          coveredByInterfaceCutout = true
          break
        }

        const cutoutZ = new Set(clippedCutout.node.availableZ)
        cellAvailableZ = cellAvailableZ.filter((z: number) => !cutoutZ.has(z))
      }
      if (coveredByInterfaceCutout || cellAvailableZ.length === 0) continue

      fragments.push({
        bounds: cellBounds,
        availableZ: cellAvailableZ,
        suffix: `__cell_${xIndex}_${yIndex}`,
      })
    }
  }

  return fragments
}

function shouldUseNodeForTopologyInterface(node: CapacityMeshNode): boolean {
  if (!isRoutingNode(node)) return false
  if (shouldPreserveGlobalNodeAsCutout(node)) return false
  if (!Number.isFinite(node.width) || !Number.isFinite(node.height)) {
    return false
  }

  return node.width > GEOMETRY_EPSILON && node.height > GEOMETRY_EPSILON
}

function createTopologyInterfaceCandidatesForDomains({
  domains,
  viaDiameter,
}: {
  domains: TopologyDomain[]
  viaDiameter: number | undefined
}): TopologyInterfaceCandidate[] {
  const interfaceCandidates: TopologyInterfaceCandidate[] = []

  for (
    let firstDomainIndex = 0;
    firstDomainIndex < domains.length;
    firstDomainIndex++
  ) {
    const firstDomain = domains[firstDomainIndex]!
    const firstNodes = firstDomain.nodes.filter(
      shouldUseNodeForTopologyInterface,
    )

    for (
      let secondDomainIndex = firstDomainIndex + 1;
      secondDomainIndex < domains.length;
      secondDomainIndex++
    ) {
      const secondDomain = domains[secondDomainIndex]!
      const secondNodes = secondDomain.nodes.filter(
        shouldUseNodeForTopologyInterface,
      )

      for (const firstNode of firstNodes) {
        for (const secondNode of secondNodes) {
          const candidate = getTopologyInterfaceCandidate({
            globalNode: firstNode,
            componentNode: secondNode,
            viaDiameter,
          })
          if (!candidate) continue

          interfaceCandidates.push({
            bounds: candidate.bounds,
            availableZ: candidate.availableZ,
            sourceNodeIds: getSortedUniqueStrings(candidate.sourceNodeIds),
          })
        }
      }
    }
  }

  return interfaceCandidates
}

function createPlanarTopologyInterfaceNodes({
  candidates,
}: {
  candidates: TopologyInterfaceCandidate[]
}): CapacityMeshNode[] {
  if (candidates.length === 0) return []

  const xCuts: number[] = []
  const yCuts: number[] = []
  for (const candidate of candidates) {
    addSortedCutCoordinate(xCuts, candidate.bounds.minX)
    addSortedCutCoordinate(xCuts, candidate.bounds.maxX)
    addSortedCutCoordinate(yCuts, candidate.bounds.minY)
    addSortedCutCoordinate(yCuts, candidate.bounds.maxY)
  }

  const interfaceNodes: CapacityMeshNode[] = []
  for (let xIndex = 0; xIndex < xCuts.length - 1; xIndex++) {
    for (let yIndex = 0; yIndex < yCuts.length - 1; yIndex++) {
      const cellBounds: Bounds = {
        minX: xCuts[xIndex]!,
        maxX: xCuts[xIndex + 1]!,
        minY: yCuts[yIndex]!,
        maxY: yCuts[yIndex + 1]!,
      }
      if (!isValidCapacityBounds(cellBounds)) continue

      const coveringCandidates = candidates.filter(
        (candidate: TopologyInterfaceCandidate): boolean =>
          isCellCoveredByCutout({
            cellBounds,
            cutoutBounds: candidate.bounds,
          }),
      )
      if (coveringCandidates.length === 0) continue

      const availableZ = getSortedUniqueZ(
        coveringCandidates.flatMap(
          (candidate: TopologyInterfaceCandidate): number[] =>
            candidate.availableZ,
        ),
      )
      const sourceNodeIds = getSortedUniqueStrings(
        coveringCandidates.flatMap(
          (candidate: TopologyInterfaceCandidate): string[] =>
            candidate.sourceNodeIds,
        ),
      )
      if (availableZ.length === 0 || sourceNodeIds.length === 0) continue

      interfaceNodes.push(
        createBoundsNode({
          bounds: cellBounds,
          capacityMeshNodeId: `topology-interface:${interfaceNodes.length}`,
          availableZ,
          role: "interface",
          componentId: "interface",
          sourceNodeIds,
        }),
      )
    }
  }

  return interfaceNodes
}

function createTopologyInterfaceNodesForDomains({
  domains,
  viaDiameter,
}: {
  domains: TopologyDomain[]
  viaDiameter: number | undefined
}): CapacityMeshNode[] {
  const candidates = createTopologyInterfaceCandidatesForDomains({
    domains,
    viaDiameter,
  })

  return createPlanarTopologyInterfaceNodes({
    candidates,
  })
}

function createCapacityMeshNodeFromLayeredFragment({
  sourceNode,
  fragment,
  capacityMeshNodeId,
}: {
  sourceNode: CapacityMeshNode
  fragment: LayeredNodeFragment
  capacityMeshNodeId: string
}): CapacityMeshNode {
  const availableZ = getSortedUniqueZ(fragment.availableZ)
  const center = getBoundsCenter(fragment.bounds)

  return {
    ...sourceNode,
    capacityMeshNodeId,
    center,
    width: getBoundsWidth(fragment.bounds),
    height: getBoundsHeight(fragment.bounds),
    layer: `z${availableZ.join(",")}`,
    availableZ,
  }
}

function splitCapacityNodeAroundLayeredCutouts({
  node,
  cutoutNodes,
}: {
  node: CapacityMeshNode
  cutoutNodes: CapacityMeshNode[]
}): CapacityMeshNode[] {
  const nodeAvailableZ = new Set(node.availableZ)
  const layerRelevantCutoutNodes = cutoutNodes.filter(
    (cutoutNode: CapacityMeshNode): boolean =>
      cutoutNode._topologyMergeRole === "interface" ||
      cutoutNode.availableZ.some((z: number) => nodeAvailableZ.has(z)),
  )

  if (node._containsObstacle || layerRelevantCutoutNodes.length === 0) {
    return [node]
  }

  const hasInterfaceCutout = layerRelevantCutoutNodes.some(
    (cutoutNode: CapacityMeshNode): boolean =>
      cutoutNode._topologyMergeRole === "interface",
  )
  const fragments = hasInterfaceCutout
    ? createPlanarFragmentsAroundCutouts({
        node,
        cutoutNodes: layerRelevantCutoutNodes,
      })
    : createLayeredFragmentsAroundCutouts({
        node,
        cutoutNodes: layerRelevantCutoutNodes,
      })

  if (
    fragments.length === 1 &&
    fragments[0]!.suffix === "" &&
    areZSetsEqual(fragments[0]!.availableZ, node.availableZ)
  ) {
    return [node]
  }

  return fragments.map((fragment: LayeredNodeFragment, index: number) =>
    createCapacityMeshNodeFromLayeredFragment({
      sourceNode: node,
      fragment,
      capacityMeshNodeId: `${node.capacityMeshNodeId}__merge_${index}${fragment.suffix}`,
    }),
  )
}

function splitNodesAroundCutouts({
  nodes,
  cutoutNodes,
  role,
  componentId,
}: {
  nodes: CapacityMeshNode[]
  cutoutNodes: CapacityMeshNode[]
  role: "global" | "component"
  componentId: string
}): CapacityMeshNode[] {
  return nodes.flatMap((node: CapacityMeshNode): CapacityMeshNode[] =>
    splitCapacityNodeAroundLayeredCutouts({
      node,
      cutoutNodes,
    }).map((splitNode: CapacityMeshNode): CapacityMeshNode => {
      const wasSplit = splitNode.capacityMeshNodeId !== node.capacityMeshNodeId

      return {
        ...splitNode,
        _topologyMergeRole: role,
        _topologyMergeComponentId:
          splitNode._topologyMergeComponentId ??
          (role === "component" || wasSplit ? componentId : undefined),
      }
    }),
  )
}

function getCutoutNodesForComponent({
  globalNodes,
  component,
}: {
  globalNodes: CapacityMeshNode[]
  component: SerializedTopologyComponentInput
}): CapacityMeshNode[] {
  return globalNodes.filter(
    (node: CapacityMeshNode): boolean =>
      shouldPreserveGlobalNodeAsCutout(node) &&
      isNodeCenterInsideObstacle({
        node,
        obstacle: component.replacementObstacle,
      }),
  )
}

function doNodesShareAnyZ(
  firstNode: CapacityMeshNode,
  secondNode: CapacityMeshNode,
): boolean {
  const secondZ = new Set(secondNode.availableZ)

  for (const z of firstNode.availableZ) {
    if (secondZ.has(z)) return true
  }

  return false
}

function shouldCheckSameLayerOverlap(node: CapacityMeshNode): boolean {
  if (!node._topologyMergeRole) return false
  if (node._containsObstacle || node._containsTarget) return false
  if (!Number.isFinite(node.width) || !Number.isFinite(node.height)) {
    return false
  }

  return node.width > GEOMETRY_EPSILON && node.height > GEOMETRY_EPSILON
}

function shouldCheckSameLayerOverlapPair({
  firstNode,
  secondNode,
}: {
  firstNode: CapacityMeshNode
  secondNode: CapacityMeshNode
}): boolean {
  if (!shouldCheckSameLayerOverlap(firstNode)) return false
  if (!shouldCheckSameLayerOverlap(secondNode)) return false
  if (firstNode._topologyMergeRole !== secondNode._topologyMergeRole) {
    return true
  }
  if (firstNode._topologyMergeRole === "interface") return true

  return (
    firstNode._topologyMergeComponentId !== undefined &&
    secondNode._topologyMergeComponentId !== undefined &&
    firstNode._topologyMergeComponentId !== secondNode._topologyMergeComponentId
  )
}

function shouldCheckPlanarOverlapPair({
  firstNode,
  secondNode,
}: {
  firstNode: CapacityMeshNode
  secondNode: CapacityMeshNode
}): boolean {
  if (!shouldCheckSameLayerOverlap(firstNode)) return false
  if (!shouldCheckSameLayerOverlap(secondNode)) return false
  if (firstNode._topologyMergeRole === "interface") return true
  if (secondNode._topologyMergeRole === "interface") return true

  return (
    shouldCheckSameLayerOverlapPair({ firstNode, secondNode }) &&
    doNodesShareAnyZ(firstNode, secondNode)
  )
}

function formatNodeBounds(node: CapacityMeshNode): string {
  const bounds = getCapacityMeshNodeBounds(node)

  return [
    `minX=${bounds.minX.toFixed(6)}`,
    `maxX=${bounds.maxX.toFixed(6)}`,
    `minY=${bounds.minY.toFixed(6)}`,
    `maxY=${bounds.maxY.toFixed(6)}`,
    `z=${node.availableZ.join(",")}`,
  ].join(" ")
}

function assertNoTopologyMergeBoundaryOverlaps(
  nodes: CapacityMeshNode[],
): void {
  const routingNodes = nodes.filter(shouldCheckSameLayerOverlap)

  for (let i = 0; i < routingNodes.length; i++) {
    const firstNode = routingNodes[i]!
    for (let j = i + 1; j < routingNodes.length; j++) {
      const secondNode = routingNodes[j]!
      if (!shouldCheckPlanarOverlapPair({ firstNode, secondNode })) {
        continue
      }

      const overlapBounds = getBoundsIntersection(
        getCapacityMeshNodeBounds(firstNode),
        getCapacityMeshNodeBounds(secondNode),
      )
      if (!overlapBounds) continue
      if (
        getBoundsWidth(overlapBounds) <= TOPOLOGY_OVERLAP_TOLERANCE ||
        getBoundsHeight(overlapBounds) <= TOPOLOGY_OVERLAP_TOLERANCE
      ) {
        continue
      }

      throw new Error(
        [
          "TopologyMergeSolver produced overlapping routing nodes at a merge boundary:",
          `${firstNode.capacityMeshNodeId} (${formatNodeBounds(firstNode)})`,
          `${secondNode.capacityMeshNodeId} (${formatNodeBounds(secondNode)})`,
          `overlap minX=${overlapBounds.minX.toFixed(6)} maxX=${overlapBounds.maxX.toFixed(6)} minY=${overlapBounds.minY.toFixed(6)} maxY=${overlapBounds.maxY.toFixed(6)}`,
        ].join(" "),
      )
    }
  }
}

export function mergeTopologyMeshNodes({
  globalMeshNodes,
  components,
  componentMeshNodes,
  layerCount,
  viaDiameter,
}: TopologyMergeSolverParams): TopologyMergeSolverOutput {
  if (!Number.isInteger(layerCount) || layerCount <= 0) {
    throw new Error(
      `TopologyMergeSolver requires a positive integer layerCount, got ${layerCount}`,
    )
  }

  if (componentMeshNodes.length !== components.length) {
    throw new Error(
      `TopologyMergeSolver expected one component mesh node group per component, got ${componentMeshNodes.length} groups for ${components.length} components`,
    )
  }

  const initialGlobalNodes = getGlobalMeshNodesForMergedTopology({
    meshNodes: globalMeshNodes,
    components,
  }).map(
    (node: CapacityMeshNode): CapacityMeshNode => ({
      ...node,
      _topologyMergeRole: "global",
    }),
  )

  const initialComponentNodeGroups = components.map(
    (
      component: SerializedTopologyComponentInput,
      componentIndex: number,
    ): CapacityMeshNode[] => {
      const rawComponentNodes = componentMeshNodes[componentIndex]
      if (!rawComponentNodes) {
        throw new Error(
          `TopologyMergeSolver missing component mesh nodes at index ${componentIndex}`,
        )
      }

      const componentNodes = rawComponentNodes.map(
        (node: CapacityMeshNode): CapacityMeshNode => ({
          ...node,
          _topologyMergeRole: "component",
          _topologyMergeComponentId: component.componentId,
        }),
      )
      const cutoutNodes = getCutoutNodesForComponent({
        globalNodes: initialGlobalNodes,
        component,
      })

      return splitNodesAroundCutouts({
        nodes: componentNodes,
        cutoutNodes,
        role: "component",
        componentId: component.componentId,
      })
    },
  )

  const topologyDomains: TopologyDomain[] = [
    {
      domainId: "global",
      role: "global",
      componentId: "global",
      nodes: initialGlobalNodes,
    },
    ...components.map(
      (
        component: SerializedTopologyComponentInput,
        componentIndex: number,
      ): TopologyDomain => ({
        domainId: component.componentId,
        role: "component",
        componentId: component.componentId,
        nodes: initialComponentNodeGroups[componentIndex]!,
      }),
    ),
  ]
  const topologyInterfaceMeshNodes = createTopologyInterfaceNodesForDomains({
    domains: topologyDomains,
    viaDiameter,
  })
  const splitTopologyDomains = topologyDomains.map(
    (domain: TopologyDomain): TopologyDomain => ({
      ...domain,
      nodes: splitNodesAroundCutouts({
        nodes: domain.nodes,
        cutoutNodes: topologyInterfaceMeshNodes,
        role: domain.role,
        componentId: domain.componentId,
      }),
    }),
  )
  const mergedGlobalNodes = splitTopologyDomains[0]!.nodes
  const mergedComponentNodeGroups = components.map(
    (
      _component: SerializedTopologyComponentInput,
      componentIndex: number,
    ): CapacityMeshNode[] => splitTopologyDomains[componentIndex + 1]!.nodes,
  )

  const mergedMeshNodes = [
    ...mergedGlobalNodes,
    ...mergedComponentNodeGroups.flat(),
    ...topologyInterfaceMeshNodes,
  ]

  assertNoTopologyMergeBoundaryOverlaps(mergedMeshNodes)

  return {
    globalMeshNodes: mergedGlobalNodes,
    componentMeshNodes: mergedComponentNodeGroups,
    topologyInterfaceMeshNodes,
    mergedMeshNodes,
  }
}

function getNodeRoleFill(node: CapacityMeshNode): string {
  if (node._containsObstacle) return "rgba(220,60,50,0.18)"
  if (node._topologyMergeRole === "interface") return "rgba(50,150,220,0.34)"
  if (node._topologyMergeRole === "component") return "rgba(225,50,65,0.16)"
  return "rgba(245,150,0,0.16)"
}

function getNodeRoleStroke(node: CapacityMeshNode): string {
  if (node._containsObstacle) return "rgba(190,40,40,0.72)"
  if (node._topologyMergeRole === "interface") return "rgba(20,145,75,0.92)"
  if (node._topologyMergeRole === "component") return "rgba(210,35,45,0.78)"
  return "rgba(235,140,0,0.8)"
}

function createVisualizationRect(node: CapacityMeshNode): Rect {
  const rect = createRectFromCapacityNode(node, {
    rectMargin: 0.015,
  })

  return {
    ...rect,
    fill: getNodeRoleFill(node),
    stroke: getNodeRoleStroke(node),
    label: [
      node._topologyMergeRole ?? "topology",
      node.capacityMeshNodeId,
      `availableZ: ${node.availableZ.join(",")}`,
      node._topologyMergeSourceNodeIds?.length
        ? `from: ${node._topologyMergeSourceNodeIds.join(",")}`
        : "",
      node._containsTarget ? "containsTarget" : "",
      node._containsObstacle ? "containsObstacle" : "",
    ]
      .filter(Boolean)
      .join("\n"),
  }
}

function getNodeRoleText(node: CapacityMeshNode): string {
  if (node._topologyMergeRole === "interface") return "I"
  if (node._topologyMergeRole === "component") return "B"
  if (node._topologyMergeRole === "global") return "T"
  return "R"
}

function createVisualizationText(node: CapacityMeshNode): Text {
  return {
    x: node.center.x,
    y: node.center.y,
    text: `${getNodeRoleText(node)}\nz=[${node.availableZ.join(",")}]`,
    layer: `z${node.availableZ.join(",")}`,
    fontSize: Math.max(0.12, Math.min(node.width, node.height) * 0.14),
    color:
      node._topologyMergeRole === "interface"
        ? "rgba(0,70,135,0.95)"
        : "rgba(80,35,0,0.9)",
    anchorSide: "center",
  }
}

export class TopologyMergeSolver extends BaseSolver {
  private output: TopologyMergeSolverOutput | null = null

  constructor(public readonly inputProblem: TopologyMergeSolverParams) {
    super()
  }

  override getConstructorParams(): [TopologyMergeSolverParams] {
    return [this.inputProblem]
  }

  override _step(): void {
    this.output = mergeTopologyMeshNodes(this.inputProblem)
    this.stats = {
      layerCount: this.inputProblem.layerCount,
      globalMeshNodeCount: this.output.globalMeshNodes.length,
      componentMeshNodeCount: this.output.componentMeshNodes.flat().length,
      topologyInterfaceMeshNodeCount:
        this.output.topologyInterfaceMeshNodes.length,
      mergedMeshNodeCount: this.output.mergedMeshNodes.length,
    }
    this.solved = true
  }

  getOutput(): TopologyMergeSolverOutput {
    if (!this.output) {
      throw new Error("TopologyMergeSolver has not solved yet")
    }

    return this.output
  }

  override visualize(): GraphicsObject {
    const output =
      this.output ??
      mergeTopologyMeshNodes({
        ...this.inputProblem,
      })

    return {
      title: "Topology Merge: planarized interface mesh",
      rects: output.mergedMeshNodes.map(createVisualizationRect),
      lines: [],
      points: [],
      circles: [],
      texts: output.mergedMeshNodes
        .filter((node: CapacityMeshNode): boolean => !node._containsObstacle)
        .map(createVisualizationText),
    }
  }

  override preview(): GraphicsObject {
    return this.visualize()
  }
}
