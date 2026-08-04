import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

type PointPair = NonNullable<NodeWithPortPoints["portPointsInPairs"]>[number]

type Crossing = {
  node: NodeWithPortPoints
  first: PointPair
  second: PointPair
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
          node,
          first,
          second,
        })
      }
    }
  }

  return crossings
}

const summarizePoint = (
  point: PointPair[number],
  node: NodeWithPortPoints,
) => {
  const bounds = {
    minX: node.center.x - node.width / 2,
    maxX: node.center.x + node.width / 2,
    minY: node.center.y - node.height / 2,
    maxY: node.center.y + node.height / 2,
  }

  return {
    portPointId: point.portPointId,
    connectionName: point.connectionName,
    rootConnectionName: point.rootConnectionName,
    x: point.x,
    y: point.y,
    z: point.z,
    distanceToNodeBoundary: Math.min(
      Math.abs(point.x - bounds.minX),
      Math.abs(point.x - bounds.maxX),
      Math.abs(point.y - bounds.minY),
      Math.abs(point.y - bounds.maxY),
    ),
    insideNodeBounds:
      point.x >= bounds.minX &&
      point.x <= bounds.maxX &&
      point.y >= bounds.minY &&
      point.y <= bounds.maxY,
  }
}

test(
  "srj24 sample 4 pathing does not cross different nets in a single-layer node",
  async (): Promise<void> => {
    const { scenario } = await loadScenarioBySampleNumber("srj24", 4, 1)
    const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario, {
      effort: 1,
      cacheProvider: null,
    })

    solver.solveUntilPhase("uniformPortDistributionSolver")
    expect(solver.failed).toBe(false)

    const pathingOutput =
      solver.portPointPathingSolver!.getOutput().nodesWithPortPoints
    const crossings = findDifferentNetSingleLayerCrossings(pathingOutput)
    const firstCrossing = crossings[0]

    console.log(
      "srj24 sample 4 single-layer crossing",
      JSON.stringify(
        firstCrossing
          ? {
              crossingCount: crossings.length,
              node: {
                capacityMeshNodeId:
                  firstCrossing.node.capacityMeshNodeId,
                center: firstCrossing.node.center,
                width: firstCrossing.node.width,
                height: firstCrossing.node.height,
                availableZ: firstCrossing.node.availableZ,
              },
              firstPair: firstCrossing.first.map((point) =>
                summarizePoint(point, firstCrossing.node),
              ),
              secondPair: firstCrossing.second.map((point) =>
                summarizePoint(point, firstCrossing.node),
              ),
            }
          : { crossingCount: 0 },
        null,
        2,
      ),
    )

    expect(crossings.length).toBe(0)
  },
  { timeout: 600_000 },
)
