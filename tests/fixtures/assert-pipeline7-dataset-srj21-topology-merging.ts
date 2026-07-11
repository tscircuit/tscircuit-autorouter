import { expect } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { ComponentKind } from "lib/solvers/ComponentDetectionSolver/detectors/types"
import {
  getBoundsIntersection,
  getCapacityMeshNodeBounds,
} from "lib/solvers/TopologyPlanningSolver/capacity-node-geometry"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

export async function assertPipeline7DatasetSrj21TopologyMerging({
  sampleNumber,
  expectedComponentKinds,
}: {
  sampleNumber: number
  expectedComponentKinds: ComponentKind[]
}): Promise<void> {
  const { scenario } = await loadScenarioBySampleNumber(
    "srj21",
    sampleNumber,
    0.1,
  )
  const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario, {
    effort: 0.1,
    cacheProvider: null,
  })

  solver.solveUntilPhase("nodeDimensionSubdivisionSolver")

  const topologyOutput = solver.topologyPlanningSolver!.getOutput()
  const mergedNodes = solver.topologyMergingSolver!.getOutput()
  const overlappingSharedLayerPairs: string[] = []

  for (let aIndex = 0; aIndex < mergedNodes.length; aIndex++) {
    const nodeA = mergedNodes[aIndex]!
    for (let bIndex = aIndex + 1; bIndex < mergedNodes.length; bIndex++) {
      const nodeB = mergedNodes[bIndex]!
      const sharesLayer = nodeA.availableZ.some((z) =>
        nodeB.availableZ.includes(z),
      )
      if (!sharesLayer) continue

      const intersection = getBoundsIntersection(
        getCapacityMeshNodeBounds(nodeA),
        getCapacityMeshNodeBounds(nodeB),
      )
      if (!intersection) continue

      overlappingSharedLayerPairs.push(
        `${nodeA.capacityMeshNodeId} <> ${nodeB.capacityMeshNodeId}`,
      )
    }
  }

  const componentKinds = solver
    .componentDetectionSolver!.getOutput()
    .map((component) => component.componentKind)
    .sort()
  const outputNodeIds = mergedNodes.map((node) => node.capacityMeshNodeId)

  expect(solver.failed).toBe(false)
  expect(solver.topologyMergingSolver?.solved).toBe(true)
  expect(componentKinds).toEqual([...expectedComponentKinds].sort())
  expect(topologyOutput.componentMeshNodes).toHaveLength(2)
  expect(
    topologyOutput.componentMeshNodes.every((nodes) => nodes.length > 0),
  ).toBe(true)
  expect(mergedNodes.length).toBeGreaterThan(0)
  expect(new Set(outputNodeIds).size).toBe(outputNodeIds.length)
  expect(
    mergedNodes.every(
      (node) =>
        Number.isFinite(node.width) &&
        Number.isFinite(node.height) &&
        node.width > 0 &&
        node.height > 0 &&
        node.availableZ.length > 0 &&
        node.availableZ.every(
          (z, index) => index === 0 || z > node.availableZ[index - 1]!,
        ),
    ),
  ).toBe(true)
  expect(overlappingSharedLayerPairs).toEqual([])
  expect(solver.capacityNodes).toEqual(mergedNodes)
}
