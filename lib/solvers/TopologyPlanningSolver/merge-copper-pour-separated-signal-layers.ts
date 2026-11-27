import Flatbush from "flatbush"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import type { SerializedTopologyComponentInput } from "./MultiGraphTopologyPlannerSolver"
import { GEOMETRY_EPSILON } from "./capacity-node-geometry"

type Rect = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

type IndexedFreeNode = {
  node: CapacityMeshNode
  idx: number
  minX: number
  maxX: number
  minY: number
  maxY: number
}

type MergedCell = {
  minX: number
  maxX: number
  minY: number
  maxY: number
  availableZ: number[]
  signature: string
  promoted: boolean
}

type RectIndex = {
  rects: Rect[]
  flatbush: Flatbush | null
}

function createRectIndex(rects: Rect[]): RectIndex {
  if (rects.length === 0) return { rects, flatbush: null }
  const flatbush = new Flatbush(rects.length)
  for (const rect of rects) {
    flatbush.add(rect.minX, rect.minY, rect.maxX, rect.maxY)
  }
  flatbush.finish()
  return { rects, flatbush }
}

function doesIndexContainPoint(
  index: RectIndex,
  x: number,
  y: number,
): boolean {
  if (!index.flatbush) return false
  const candidates = index.flatbush.search(
    x - GEOMETRY_EPSILON,
    y - GEOMETRY_EPSILON,
    x + GEOMETRY_EPSILON,
    y + GEOMETRY_EPSILON,
  )
  for (const candidateIndex of candidates) {
    const rect = index.rects[candidateIndex]!
    if (
      x >= rect.minX - GEOMETRY_EPSILON &&
      x <= rect.maxX + GEOMETRY_EPSILON &&
      y >= rect.minY - GEOMETRY_EPSILON &&
      y <= rect.maxY + GEOMETRY_EPSILON
    ) {
      return true
    }
  }
  return false
}

function doesIndexOverlapRect(index: RectIndex, target: Rect): boolean {
  if (!index.flatbush) return false
  const candidates = index.flatbush.search(
    target.minX,
    target.minY,
    target.maxX,
    target.maxY,
  )
  for (const candidateIndex of candidates) {
    const rect = index.rects[candidateIndex]!
    if (
      target.minX < rect.maxX - GEOMETRY_EPSILON &&
      target.maxX > rect.minX + GEOMETRY_EPSILON &&
      target.minY < rect.maxY - GEOMETRY_EPSILON &&
      target.maxY > rect.minY + GEOMETRY_EPSILON
    ) {
      return true
    }
  }
  return false
}

function getSortedUniqueCoordinates(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  const unique: number[] = []
  for (const value of sorted) {
    const previous = unique[unique.length - 1]
    if (
      previous === undefined ||
      Math.abs(value - previous) > GEOMETRY_EPSILON
    ) {
      unique.push(value)
    }
  }
  return unique
}

function compactMergedCells(initialCells: MergedCell[]): MergedCell[] {
  let current = initialCells
  for (let pass = 0; pass < 4; pass++) {
    const byColumn = new Map<string, MergedCell[]>()
    for (const cell of current) {
      const key = `${cell.signature}|${cell.minX.toPrecision(12)}|${cell.maxX.toPrecision(12)}`
      const bucket = byColumn.get(key)
      if (bucket) bucket.push(cell)
      else byColumn.set(key, [cell])
    }

    const verticallyMerged: MergedCell[] = []
    for (const columnCells of byColumn.values()) {
      columnCells.sort((a, b) => a.minY - b.minY)
      for (const cell of columnCells) {
        const previous = verticallyMerged[verticallyMerged.length - 1]
        if (
          previous &&
          previous.signature === cell.signature &&
          Math.abs(previous.minX - cell.minX) <= GEOMETRY_EPSILON &&
          Math.abs(previous.maxX - cell.maxX) <= GEOMETRY_EPSILON &&
          Math.abs(previous.maxY - cell.minY) <= GEOMETRY_EPSILON
        ) {
          previous.maxY = cell.maxY
        } else {
          verticallyMerged.push({ ...cell })
        }
      }
    }

    const byRow = new Map<string, MergedCell[]>()
    for (const cell of verticallyMerged) {
      const key = `${cell.signature}|${cell.minY.toPrecision(12)}|${cell.maxY.toPrecision(12)}`
      const bucket = byRow.get(key)
      if (bucket) bucket.push(cell)
      else byRow.set(key, [cell])
    }

    const horizontallyMerged: MergedCell[] = []
    for (const rowCells of byRow.values()) {
      rowCells.sort((a, b) => a.minX - b.minX)
      for (const cell of rowCells) {
        const previous = horizontallyMerged[horizontallyMerged.length - 1]
        if (
          previous &&
          previous.signature === cell.signature &&
          Math.abs(previous.minY - cell.minY) <= GEOMETRY_EPSILON &&
          Math.abs(previous.maxY - cell.maxY) <= GEOMETRY_EPSILON &&
          Math.abs(previous.maxX - cell.minX) <= GEOMETRY_EPSILON
        ) {
          previous.maxX = cell.maxX
        } else {
          horizontallyMerged.push({ ...cell })
        }
      }
    }

    if (horizontallyMerged.length === current.length) break
    current = horizontallyMerged
  }
  return current
}

function getExteriorFixedViaFootprints({
  inputSrj,
  components,
  defaultViaDiameter,
}: {
  inputSrj: SimpleRouteJson
  components: readonly SerializedTopologyComponentInput[]
  defaultViaDiameter: number
}): Rect[] {
  const componentBounds: Rect[] = components.map(({ replacementObstacle }) => ({
    minX: replacementObstacle.center.x - replacementObstacle.width / 2,
    maxX: replacementObstacle.center.x + replacementObstacle.width / 2,
    minY: replacementObstacle.center.y - replacementObstacle.height / 2,
    maxY: replacementObstacle.center.y + replacementObstacle.height / 2,
  }))

  const footprints: Rect[] = []
  for (const trace of inputSrj.traces ?? []) {
    if (!trace.isFixed) continue
    for (const point of trace.route) {
      if (point.route_type !== "via") continue
      const insideComponent = componentBounds.some(
        (bounds) =>
          point.x >= bounds.minX - GEOMETRY_EPSILON &&
          point.x <= bounds.maxX + GEOMETRY_EPSILON &&
          point.y >= bounds.minY - GEOMETRY_EPSILON &&
          point.y <= bounds.maxY + GEOMETRY_EPSILON,
      )
      if (insideComponent) continue
      const radius = (point.via_diameter ?? defaultViaDiameter) / 2
      footprints.push({
        minX: point.x - radius,
        maxX: point.x + radius,
        minY: point.y - radius,
        maxY: point.y + radius,
      })
    }
  }
  return footprints
}

/**
 * Promotes overlapping free global signal layers (including inner signal layers
 * separated by inner copper pours) into through-via-capable multi-layer nodes.
 *
 * `@tscircuit/rectdiff`'s outer-layer merge only pairs top and bottom layers and
 * skips regions over partial inner pours, leaving inner signal layers stranded as
 * isolated single-layer sheets on 6+ layer stackups. Keeping exterior fixed via
 * pad footprints unpromoted prevents planning new vias or crossings directly over
 * protruding fixed dogbone vias while leaving adjacent open space via-capable.
 */
export function mergeCopperPourSeparatedSignalLayers({
  meshNodes,
  inputSrj,
  components,
  viaDiameter,
  obstacleMargin,
}: {
  meshNodes: CapacityMeshNode[]
  inputSrj: SimpleRouteJson
  components: readonly SerializedTopologyComponentInput[]
  viaDiameter?: number
  obstacleMargin?: number
}): CapacityMeshNode[] {
  const layerCount = inputSrj.layerCount
  if (layerCount < 3 || inputSrj.allowBlindAndBuriedVias) return meshNodes

  const copperPourRectsByZ: Rect[][] = Array.from(
    { length: layerCount },
    () => [],
  )
  const nonPourRectsByZ: Rect[][] = Array.from({ length: layerCount }, () => [])
  let hasInnerPour = false

  for (const obstacle of inputSrj.obstacles) {
    const zLayers =
      obstacle.zLayers ??
      obstacle.layers.map((layer) => mapLayerNameToZ(layer, layerCount))
    const rect: Rect = {
      minX: obstacle.center.x - obstacle.width / 2,
      maxX: obstacle.center.x + obstacle.width / 2,
      minY: obstacle.center.y - obstacle.height / 2,
      maxY: obstacle.center.y + obstacle.height / 2,
    }
    for (const z of zLayers) {
      if (z < 0 || z >= layerCount) continue
      if (obstacle.isCopperPour) {
        if (z > 0 && z < layerCount - 1) hasInnerPour = true
        copperPourRectsByZ[z]!.push(rect)
      } else {
        nonPourRectsByZ[z]!.push(rect)
      }
    }
  }
  if (!hasInnerPour) return meshNodes

  // Only needed when an inner signal layer is sandwiched between copper-pour
  // layers above and below it. RectDiff natively merges adjacent free layers
  // and its OuterLayerContainmentMergeSolver merges outer-layer stacks that
  // already touch top (0) or bottom (layerCount - 1), whereas sandwiched inner
  // signal layers are left stranded as isolated single-layer regions.
  let hasSandwichedInnerSignalLayer = false
  for (let z = 1; z < layerCount - 1; z++) {
    if (copperPourRectsByZ[z]!.length > 0) continue
    let hasPourBelow = false
    let hasPourAbove = false
    for (let belowZ = 0; belowZ < z; belowZ++) {
      if (copperPourRectsByZ[belowZ]!.length > 0) {
        hasPourBelow = true
        break
      }
    }
    for (let aboveZ = z + 1; aboveZ < layerCount; aboveZ++) {
      if (copperPourRectsByZ[aboveZ]!.length > 0) {
        hasPourAbove = true
        break
      }
    }
    if (hasPourBelow && hasPourAbove) {
      hasSandwichedInnerSignalLayer = true
      break
    }
  }
  if (!hasSandwichedInnerSignalLayer) return meshNodes

  const resolvedViaDiameter =
    viaDiameter ?? getViaDimensions(inputSrj).padDiameter
  const viaMinSize = Math.max(resolvedViaDiameter, inputSrj.minTraceWidth || 0)
  const clearance =
    inputSrj.minTraceToPadEdgeClearance ??
    obstacleMargin ??
    inputSrj.defaultObstacleMargin ??
    0.15

  const copperPourIndexByZ = copperPourRectsByZ.map(createRectIndex)
  const nonPourIndexByZ = nonPourRectsByZ.map(createRectIndex)

  const freeNodes: CapacityMeshNode[] = []
  const preservedNodes: CapacityMeshNode[] = []
  const usedNodeIds = new Set<string>()
  for (const node of meshNodes) {
    if (
      node._containsObstacle ||
      node._containsTarget ||
      node._isVirtualOffboard
    ) {
      preservedNodes.push(node)
      usedNodeIds.add(node.capacityMeshNodeId)
    } else {
      freeNodes.push(node)
    }
  }
  if (freeNodes.length < 2) return meshNodes

  const preparedFree: IndexedFreeNode[] = freeNodes.map((node, idx) => ({
    node,
    idx,
    minX: node.center.x - node.width / 2,
    maxX: node.center.x + node.width / 2,
    minY: node.center.y - node.height / 2,
    maxY: node.center.y + node.height / 2,
  }))
  const freeIndex = createRectIndex(preparedFree)

  const exteriorFixedVias = getExteriorFixedViaFootprints({
    inputSrj,
    components,
    defaultViaDiameter: resolvedViaDiameter,
  }).filter((viaRect) => doesIndexOverlapRect(freeIndex, viaRect))

  const sortedFreeByMinX = [...preparedFree].sort((a, b) => a.minX - b.minX)
  const sortedViasByMinX = [...exteriorFixedVias].sort(
    (a, b) => a.minX - b.minX,
  )
  const xCoordinates = getSortedUniqueCoordinates([
    ...preparedFree.flatMap((item) => [item.minX, item.maxX]),
    ...exteriorFixedVias.flatMap((via) => [via.minX, via.maxX]),
  ])

  const cells: MergedCell[] = []
  let prevByBucket = new Map<string, MergedCell>()
  let nextFreeCursor = 0
  let nextViaCursor = 0
  let activeFreeInX: IndexedFreeNode[] = []
  let activeViasInX: Rect[] = []
  let promotedCellCount = 0

  for (let xIndex = 0; xIndex < xCoordinates.length - 1; xIndex++) {
    const minX = xCoordinates[xIndex]!
    const maxX = xCoordinates[xIndex + 1]!
    if (maxX - minX <= GEOMETRY_EPSILON) continue
    const centerX = (minX + maxX) / 2

    while (
      nextFreeCursor < sortedFreeByMinX.length &&
      sortedFreeByMinX[nextFreeCursor]!.minX <= centerX + GEOMETRY_EPSILON
    ) {
      activeFreeInX.push(sortedFreeByMinX[nextFreeCursor]!)
      nextFreeCursor++
    }
    activeFreeInX = activeFreeInX.filter(
      (item) => item.maxX >= centerX - GEOMETRY_EPSILON,
    )
    if (activeFreeInX.length === 0) {
      prevByBucket = new Map()
      continue
    }

    while (
      nextViaCursor < sortedViasByMinX.length &&
      sortedViasByMinX[nextViaCursor]!.minX <= centerX + GEOMETRY_EPSILON
    ) {
      activeViasInX.push(sortedViasByMinX[nextViaCursor]!)
      nextViaCursor++
    }
    activeViasInX = activeViasInX.filter(
      (via) => via.maxX >= centerX - GEOMETRY_EPSILON,
    )

    const yCoordinates = getSortedUniqueCoordinates([
      ...activeFreeInX.flatMap((item) => [item.minY, item.maxY]),
      ...activeViasInX.flatMap((via) => [via.minY, via.maxY]),
    ])
    const nextByBucket = new Map<string, MergedCell>()

    for (let yIndex = 0; yIndex < yCoordinates.length - 1; yIndex++) {
      const minY = yCoordinates[yIndex]!
      const maxY = yCoordinates[yIndex + 1]!
      if (maxY - minY <= GEOMETRY_EPSILON) continue
      const centerY = (minY + maxY) / 2

      const covering = activeFreeInX.filter(
        (item) =>
          centerY >= item.minY - GEOMETRY_EPSILON &&
          centerY <= item.maxY + GEOMETRY_EPSILON,
      )
      if (covering.length === 0) continue

      const blockedByFixedVia = activeViasInX.some(
        (via) =>
          centerY >= via.minY - GEOMETRY_EPSILON &&
          centerY <= via.maxY + GEOMETRY_EPSILON,
      )

      const freeLayers = new Set<number>()
      for (const item of covering) {
        for (const z of item.node.availableZ) freeLayers.add(z)
      }

      let canThroughVia = !blockedByFixedVia && freeLayers.size >= 2
      if (canThroughVia) {
        for (let z = 0; z < layerCount; z++) {
          if (freeLayers.has(z)) continue
          const hasPour = doesIndexContainPoint(
            copperPourIndexByZ[z]!,
            centerX,
            centerY,
          )
          const hasNonPour = doesIndexContainPoint(
            nonPourIndexByZ[z]!,
            centerX,
            centerY,
          )
          if (!hasPour || hasNonPour) {
            canThroughVia = false
            break
          }
        }
      }

      const emitted: Array<{
        availableZ: number[]
        signature: string
        promoted: boolean
      }> = []

      if (canThroughVia) {
        const promotedZ: number[] = []
        const unpromotedZ: number[] = []
        const paddedCell: Rect = {
          minX: minX - clearance,
          maxX: maxX + clearance,
          minY: minY - clearance,
          maxY: maxY + clearance,
        }
        for (const z of [...freeLayers].sort((a, b) => a - b)) {
          const isInnerPourSplitGap =
            z > 0 &&
            z < layerCount - 1 &&
            doesIndexOverlapRect(copperPourIndexByZ[z]!, paddedCell)
          if (isInnerPourSplitGap) unpromotedZ.push(z)
          else promotedZ.push(z)
        }

        if (promotedZ.length >= 2) {
          promotedCellCount++
          emitted.push({
            availableZ: promotedZ,
            signature: `tv:${promotedZ.join(",")}`,
            promoted: true,
          })
          for (const z of unpromotedZ) {
            emitted.push({
              availableZ: [z],
              signature: `pourgap:${z}`,
              promoted: false,
            })
          }
        }
      }

      if (emitted.length === 0) {
        const seenIndexes = new Set<number>()
        for (const item of covering) {
          if (seenIndexes.has(item.idx)) continue
          seenIndexes.add(item.idx)
          emitted.push({
            availableZ: [...item.node.availableZ],
            signature: `orig:${item.idx}`,
            promoted: false,
          })
        }
      }

      for (const entry of emitted) {
        const bucketKey = `${entry.signature}|${minY.toPrecision(12)}|${maxY.toPrecision(12)}`
        const previous = prevByBucket.get(bucketKey)
        if (previous && Math.abs(previous.maxX - minX) <= GEOMETRY_EPSILON) {
          previous.maxX = maxX
          nextByBucket.set(bucketKey, previous)
        } else {
          const cell: MergedCell = {
            minX,
            maxX,
            minY,
            maxY,
            availableZ: entry.availableZ,
            signature: entry.signature,
            promoted: entry.promoted,
          }
          cells.push(cell)
          nextByBucket.set(bucketKey, cell)
        }
      }
    }
    prevByBucket = nextByBucket
  }

  if (promotedCellCount === 0) return meshNodes

  const compacted = compactMergedCells(cells)
  const mergedFreeNodes: CapacityMeshNode[] = []
  let nextId = 0

  const allocateNodeId = (prefix: string): string => {
    let candidate = `${prefix}_${nextId++}`
    while (usedNodeIds.has(candidate)) {
      candidate = `${prefix}_${nextId++}`
    }
    usedNodeIds.add(candidate)
    return candidate
  }

  for (const cell of compacted) {
    const width = cell.maxX - cell.minX
    const height = cell.maxY - cell.minY
    const center = {
      x: (cell.minX + cell.maxX) / 2,
      y: (cell.minY + cell.maxY) / 2,
    }
    if (
      cell.promoted &&
      (width + GEOMETRY_EPSILON < viaMinSize ||
        height + GEOMETRY_EPSILON < viaMinSize)
    ) {
      for (const z of cell.availableZ) {
        mergedFreeNodes.push({
          capacityMeshNodeId: allocateNodeId("global_tv_sliver"),
          center,
          width,
          height,
          availableZ: [z],
          layer: `z${z}`,
        })
      }
    } else {
      mergedFreeNodes.push({
        capacityMeshNodeId: allocateNodeId("global_tv_merge"),
        center,
        width,
        height,
        availableZ: cell.availableZ,
        layer: `z${cell.availableZ.join(",")}`,
      })
    }
  }

  return [...preservedNodes, ...mergedFreeNodes]
}
