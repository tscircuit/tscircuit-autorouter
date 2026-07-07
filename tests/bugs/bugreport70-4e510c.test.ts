import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import phaseInputs from "../../fixtures/bug-reports/bugreport70-4e510c/bugreport70-4e510c.phase-inputs.srj.json" with {
  type: "json",
}
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = phaseInputs[0] as SimpleRouteJson

test("bugreport70-4e510c pipeline7 failure visualization", (): void => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(srj, {
    cacheProvider: null,
  })

  solver.solve()

  const topologyOutput = solver.topologyPlanningSolver!.getOutput()
  const rawGlobalNodes =
    solver.topologyPlanningSolver!.getStageOutput<{
      meshNodes: CapacityMeshNode[]
    }>("globalTopologySolver")?.meshNodes ?? []
  const rawGlobalNodeIds = new Set(
    rawGlobalNodes.map((node) => node.capacityMeshNodeId),
  )
  const mergedNodeIds = new Set(
    topologyOutput.mergedMeshNodes.map((node) => node.capacityMeshNodeId),
  )
  const preservedGlobalNodeIds = rawGlobalNodes
    .filter((node) => mergedNodeIds.has(node.capacityMeshNodeId))
    .map((node) => node.capacityMeshNodeId)
  const cutoutNodeIds = topologyOutput.mergedMeshNodes
    .map((node) => node.capacityMeshNodeId)
    .filter((nodeId) => nodeId.includes("__merge_"))
  const bridgeEdges =
    solver.capacityEdges?.filter((edge) => {
      const [nodeA, nodeB] = edge.nodeIds
      return (
        (preservedGlobalNodeIds.includes(nodeA) &&
          !rawGlobalNodeIds.has(nodeB)) ||
        (preservedGlobalNodeIds.includes(nodeB) && !rawGlobalNodeIds.has(nodeA))
      )
    }) ?? []

  expect(preservedGlobalNodeIds.length).toBeGreaterThan(0)
  expect(cutoutNodeIds.length).toBeGreaterThan(0)
  expect(bridgeEdges.length).toBeGreaterThan(0)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
