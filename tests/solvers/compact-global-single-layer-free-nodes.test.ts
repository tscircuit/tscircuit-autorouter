import { expect, test } from "bun:test"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { compactGlobalSingleLayerFreeNodes } from "lib/solvers/NodeDimensionSubdivisionSolver/compactGlobalSingleLayerFreeNodes"
import type { CapacityMeshNode } from "lib/types"

function node(id: string, x: number, y: number, width = 1, height = 1): CapacityMeshNode {
  return {
    capacityMeshNodeId: id,
    center: { x, y }, width, height,
    availableZ: [0], layer: "z0",
  }
}

function expectSameLayerCoverage(before: CapacityMeshNode[], after: CapacityMeshNode[]): void {
  const nodes = [...before, ...after]
  const xs = [...new Set(nodes.flatMap((n) => [n.center.x - n.width / 2, n.center.x + n.width / 2]))].sort((a, b) => a - b)
  const ys = [...new Set(nodes.flatMap((n) => [n.center.y - n.height / 2, n.center.y + n.height / 2]))].sort((a, b) => a - b)
  const layers = [...new Set(nodes.flatMap((n) => n.availableZ))]
  for (const z of layers) {
    for (let xIndex = 1; xIndex < xs.length; xIndex++) {
      for (let yIndex = 1; yIndex < ys.length; yIndex++) {
        if (xs[xIndex]! - xs[xIndex - 1]! < 1e-10 || ys[yIndex]! - ys[yIndex - 1]! < 1e-10) continue
        const x = (xs[xIndex]! + xs[xIndex - 1]!) / 2
        const y = (ys[yIndex]! + ys[yIndex - 1]!) / 2
        const coversBefore = before.some((n) => n.availableZ.includes(z) && Math.abs(n.center.x - x) < n.width / 2 && Math.abs(n.center.y - y) < n.height / 2)
        const coversAfter = after.some((n) => n.availableZ.includes(z) && Math.abs(n.center.x - x) < n.width / 2 && Math.abs(n.center.y - y) < n.height / 2)
        expect(coversAfter).toBe(coversBefore)
      }
    }
  }
}

test("compacts artificial free partitions while preserving layer geometry, roles and dimension limits", (): void => {
  const vertical = [node("first", 0, 1), node("second", 0, 0)]
  const snapshot = structuredClone(vertical)
  const merged = compactGlobalSingleLayerFreeNodes(vertical)
  expect(merged).toHaveLength(1)
  expect(merged[0]!.capacityMeshNodeId).toBe("first")
  expect(merged[0]!.width).toBe(1)
  expect(merged[0]!.height).toBe(2)
  expect(vertical).toEqual(snapshot)
  expectSameLayerCoverage(vertical, merged)
  for (const property of [
    { _containsTarget: true }, { _containsObstacle: true },
    { _completelyInsideObstacle: true }, { _isComponentTopologyNode: true },
    { _isNarrowQfpPadGap: true }, { _targetConnectionName: "signal" },
    { _connectedTo: ["signal"] }, { _offBoardConnectionId: "virtual" },
    { _isVirtualOffboard: true }, { _qfpRegionType: "center" },
    { _soicRegionType: "pad-gap" }, { netId: 0 },
    { _assignableVia: true }, { _strawNode: true },
    { unknownRole: false }, { availableZ: [0, 1] },
    { availableZ: [1] }, { _parent: node("parent", 0, 0, 2, 2) },
  ]) {
    const protectedNode = { ...vertical[0]!, ...property } as CapacityMeshNode
    const result = compactGlobalSingleLayerFreeNodes([protectedNode, vertical[1]!])
    expect(result).toHaveLength(2)
    expect(result[0]).toBe(protectedNode)
    expect(result[1]).toBe(vertical[1])
  }
  const separated = [node("left", 0, 0), node("right", 1 + 1e-8, 0)]
  expect(compactGlobalSingleLayerFreeNodes(separated)).toEqual(separated)
  const overlapping = [node("left", 0, 0), node("right", 0.5, 0)]
  expect(compactGlobalSingleLayerFreeNodes(overlapping)).toEqual(overlapping)
  const lShape = [node("a", 0, 0), node("b", 1, 0), node("c", 0, 1)]
  expectSameLayerCoverage(lShape, compactGlobalSingleLayerFreeNodes(lShape))
  const tall = Array.from({ length: 6 }, (_, index) => node(`slice-${index}`, 0, index))
  const bounded = compactGlobalSingleLayerFreeNodes(tall, 3)
  expect(bounded).toHaveLength(2)
  expect(bounded.every((n) => n.width <= 3 && n.height <= 3)).toBe(true)
  expectSameLayerCoverage(tall, bounded)
  for (const disabledLimit of [0, -1, Infinity, NaN]) {
    const unbounded = compactGlobalSingleLayerFreeNodes(tall, disabledLimit)
    expect(unbounded).toHaveLength(1)
    expect(unbounded[0]!.height).toBe(6)
  }

  // Sample024 U9's bottom free strip inherited a top-pad x boundary. Its
  // 6.36um-wide, 38um-high slices create cramped ports in open bottom space.
  const stripHeight = 0.03801672514619876
  const stripWidth = 0.006360159999985626
  const stripX = 178.16424107999995
  const stripBottom = 129.09915636 - stripHeight / 2
  const strip = Array.from({ length: 32 }, (_, index) => ({
    ...node(`strip-${index}`, stripX, stripBottom + stripHeight * (index + 0.5), stripWidth, stripHeight),
    availableZ: [7], layer: "z7",
  }))
  const neighbor = {
    ...node("neighbor", stripX - stripWidth / 2 - 0.5, stripBottom + stripHeight * 16, 1, stripHeight * 32),
    availableZ: [0, 7],
  }
  const input = [neighbor, ...strip]
  const inputSnapshot = structuredClone(input)
  const compacted = compactGlobalSingleLayerFreeNodes(input)
  expect(compacted).toHaveLength(2)
  expect(compacted[0]).toBe(neighbor)
  expect(compacted[1]!.height).toBeCloseTo(stripHeight * 32, 10)
  expect(input).toEqual(inputSnapshot)
  expectSameLayerCoverage(input, compacted)
  for (const [index, freeStrip] of [strip[0]!, compacted[1]!].entries()) {
    const ports = new AvailableSegmentPointSolver({
      nodes: [neighbor, freeStrip],
      edges: [{ capacityMeshEdgeId: "gate", nodeIds: [neighbor.capacityMeshNodeId, freeStrip.capacityMeshNodeId] }],
      traceWidth: 0.1524, obstacleMargin: 0.15,
      shouldReturnCrampedPortPoints: true,
    })
    ports.solve()
    const points = ports.getOutput().flatMap((segment) => segment.portPoints)
    expect(points.length).toBeGreaterThan(0)
    expect(points.every((point) => point.cramped)).toBe(index === 0)
    if (index === 1) expect(points.every((point) => !point.cramped)).toBe(true)
  }
})
