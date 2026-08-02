import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

type PointPair = NonNullable<NodeWithPortPoints["portPointsInPairs"]>[number]

type Crossing = {
  nodeId: string
  firstConnection: string
  secondConnection: string
  firstPortIds: [string | undefined, string | undefined]
  secondPortIds: [string | undefined, string | undefined]
}

const crossProduct = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

const segmentsCrossStrictly = (first: PointPair, second: PointPair) => {
  const [a, b] = first
  const [c, d] = second
  const firstSideA = crossProduct(a, b, c)
  const firstSideB = crossProduct(a, b, d)
  const secondSideA = crossProduct(c, d, a)
  const secondSideB = crossProduct(c, d, b)

  return firstSideA * firstSideB < 0 && secondSideA * secondSideB < 0
}

const findDifferentNetSingleLayerCrossings = (
  nodes: NodeWithPortPoints[],
): Crossing[] => {
  const crossings: Crossing[] = []

  for (const node of nodes) {
    if (node.availableZ.length !== 1) continue

    const pairs = node.portPointsInPairs ?? []
    for (let firstIndex = 0; firstIndex < pairs.length; firstIndex++) {
      const first = pairs[firstIndex]!
      if (first[0].z !== first[1].z) continue

      for (
        let secondIndex = firstIndex + 1;
        secondIndex < pairs.length;
        secondIndex++
      ) {
        const second = pairs[secondIndex]!
        if (second[0].z !== second[1].z || first[0].z !== second[0].z) {
          continue
        }
        if (first[0].rootConnectionName === second[0].rootConnectionName) {
          continue
        }
        if (!segmentsCrossStrictly(first, second)) continue

        crossings.push({
          nodeId: node.capacityMeshNodeId,
          firstConnection: first[0].connectionName,
          secondConnection: second[0].connectionName,
          firstPortIds: [first[0].portPointId, first[1].portPointId],
          secondPortIds: [second[0].portPointId, second[1].portPointId],
        })
      }
    }
  }

  return crossings
}

test(
  "srj24 sample 4 keeps single-layer boundary ordering through uniform distribution",
  async (): Promise<void> => {
    const { scenario } = await loadScenarioBySampleNumber("srj24", 4, 1)
    const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario, {
      effort: 1,
      cacheProvider: null,
    })

    solver.solveUntilPhase("uniformPortDistributionSolver")
    expect(solver.failed).toBe(false)

    const beforeUniform =
      solver.portPointPathingSolver!.getOutput().nodesWithPortPoints
    const beforeCrossings =
      findDifferentNetSingleLayerCrossings(beforeUniform)

    solver.solveUntilPhase("highDensityRouteSolver")
    expect(solver.failed).toBe(false)

    const afterUniform = solver.uniformPortDistributionSolver!.getOutput()
    const afterCrossings = findDifferentNetSingleLayerCrossings(afterUniform)

    console.log(
      "srj24 sample 4 boundary-order handoff",
      JSON.stringify(
        {
          beforeUniform: beforeCrossings,
          afterUniform: afterCrossings,
        },
        null,
        2,
      ),
    )

    expect(afterCrossings).toEqual([])
  },
  { timeout: 600_000 },
)
