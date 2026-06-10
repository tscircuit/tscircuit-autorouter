import { expect, test } from "bun:test"
import { BgaTopologyGeneratorSolver } from "lib/solvers/BgaTopologyGeneratorSolver/BgaTopologyGeneratorSolver"
import { ComponentDetectionSolver } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import type { CapacityMeshNode } from "lib/types"
import { areNodesBordering } from "lib/utils/areNodesBordering"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

const doNodeBoundsOverlap = (nodeA: CapacityMeshNode, nodeB: CapacityMeshNode) => {
  const nodeABounds = {
    minX: nodeA.center.x - nodeA.width / 2,
    maxX: nodeA.center.x + nodeA.width / 2,
    minY: nodeA.center.y - nodeA.height / 2,
    maxY: nodeA.center.y + nodeA.height / 2,
  }
  const nodeBBounds = {
    minX: nodeB.center.x - nodeB.width / 2,
    maxX: nodeB.center.x + nodeB.width / 2,
    minY: nodeB.center.y - nodeB.height / 2,
    maxY: nodeB.center.y + nodeB.height / 2,
  }

  const overlapWidth =
    Math.min(nodeABounds.maxX, nodeBBounds.maxX) -
    Math.max(nodeABounds.minX, nodeBBounds.minX)
  const overlapHeight =
    Math.min(nodeABounds.maxY, nodeBBounds.maxY) -
    Math.max(nodeABounds.minY, nodeBBounds.minY)

  return overlapWidth > 1e-6 && overlapHeight > 1e-6
}

const shareLayer = (nodeA: CapacityMeshNode, nodeB: CapacityMeshNode) =>
  nodeA.availableZ.some((z) => nodeB.availableZ.includes(z))

const doNodesTouchAtCorner = (
  nodeA: CapacityMeshNode,
  nodeB: CapacityMeshNode,
) => {
  const nodeABounds = {
    minX: nodeA.center.x - nodeA.width / 2,
    maxX: nodeA.center.x + nodeA.width / 2,
    minY: nodeA.center.y - nodeA.height / 2,
    maxY: nodeA.center.y + nodeA.height / 2,
  }
  const nodeBBounds = {
    minX: nodeB.center.x - nodeB.width / 2,
    maxX: nodeB.center.x + nodeB.width / 2,
    minY: nodeB.center.y - nodeB.height / 2,
    maxY: nodeB.center.y + nodeB.height / 2,
  }
  const epsilon = 1e-9

  const touchesHorizontally =
    Math.abs(nodeABounds.maxX - nodeBBounds.minX) <= epsilon ||
    Math.abs(nodeABounds.minX - nodeBBounds.maxX) <= epsilon
  const touchesVertically =
    Math.abs(nodeABounds.maxY - nodeBBounds.minY) <= epsilon ||
    Math.abs(nodeABounds.minY - nodeBBounds.maxY) <= epsilon

  return touchesHorizontally && touchesVertically
}

const areNodesConnected = (nodeA: CapacityMeshNode, nodeB: CapacityMeshNode) =>
  shareLayer(nodeA, nodeB) &&
  (doNodeBoundsOverlap(nodeA, nodeB) ||
    areNodesBordering(nodeA, nodeB) ||
    doNodesTouchAtCorner(nodeA, nodeB))

const getConnectedNodeCount = (nodes: CapacityMeshNode[]) => {
  if (nodes.length === 0) return 0

  const visited = new Set<number>([0])
  const queue = [0]

  while (queue.length > 0) {
    const currentIndex = queue.shift()!
    const currentNode = nodes[currentIndex]!

    for (let candidateIndex = 0; candidateIndex < nodes.length; candidateIndex++) {
      if (visited.has(candidateIndex)) continue

      const candidateNode = nodes[candidateIndex]!
      if (!areNodesConnected(currentNode, candidateNode)) continue

      visited.add(candidateIndex)
      queue.push(candidateIndex)
    }
  }

  return visited.size
}

test("srj18 sample013 component topology regions are valid and BFS-connected", async () => {
  const sample = await loadScenarioBySampleNumber("srj18", 13)
  const componentDetectionSolver = new ComponentDetectionSolver({
    inputSrj: sample.scenario,
  })

  componentDetectionSolver.solve()

  const detectedComponents = componentDetectionSolver.getOutput()
  expect(detectedComponents.length).toBeGreaterThan(0)

  for (const detectedComponent of detectedComponents) {
    expect(detectedComponent.componentKind).toBe("bga")

    const topologyGenerator = new BgaTopologyGeneratorSolver({
      inputSrj: sample.scenario,
      detectedComponent,
    })

    topologyGenerator.solve()

    const routingRegions = topologyGenerator.getOutput().routingRegions
    expect(routingRegions.length).toBeGreaterThan(0)

    for (const region of routingRegions) {
      expect(region.width).toBeGreaterThan(1e-6)
      expect(region.height).toBeGreaterThan(1e-6)
      expect(region.availableZ.length).toBeGreaterThan(0)

      const dedupedAvailableZ = Array.from(new Set(region.availableZ)).sort(
        (a, b) => a - b,
      )

      expect(region.availableZ.slice().sort((a, b) => a - b)).toEqual(
        dedupedAvailableZ,
      )

      for (const z of region.availableZ) {
        expect(Number.isInteger(z)).toBe(true)
        expect(z).toBeGreaterThanOrEqual(0)
        expect(z).toBeLessThan(sample.scenario.layerCount)
      }
    }

    expect(getConnectedNodeCount(routingRegions)).toBe(routingRegions.length)
  }
})
