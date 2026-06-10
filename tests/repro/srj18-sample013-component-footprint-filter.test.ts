import { expect, test } from "bun:test"
import { getBoundFromCenteredRect } from "@tscircuit/math-utils"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { ComponentDetectionSolver } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import { createReplacementObstacleForComponent } from "lib/solvers/ComponentTopologyGeneratorSolver/ComponentTopologyGeneratorSolver"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("pipeline7 filters global mesh nodes inside srj18 sample013 component footprints", async () => {
  const sample = await loadScenarioBySampleNumber("srj18", 13)
  const componentDetectionSolver = new ComponentDetectionSolver({
    inputSrj: sample.scenario,
  })

  componentDetectionSolver.solve()

  const replacementObstacles = componentDetectionSolver
    .getOutput()
    .map((detectedComponent) =>
      createReplacementObstacleForComponent({
        detectedComponent,
        inputSrj: sample.scenario,
      }),
    )

  const solver = new AutoroutingPipelineSolver7_MultiGraph(sample.scenario)
  solver.solveUntilPhase("edgeSolver")

  const nodesInsideComponentFootprint = (solver.capacityNodes ?? []).filter(
    (node) => {
      if (node.capacityMeshNodeId.startsWith("bgp:")) return false

      const nodeBounds = getBoundFromCenteredRect({
        center: node.center,
        width: node.width,
        height: node.height,
      })

      return replacementObstacles.some((obstacle) => {
        const obstacleBounds = getBoundFromCenteredRect({
          center: obstacle.center,
          width: obstacle.width,
          height: obstacle.height,
        })
        const epsilon = 1e-9

        return (
          nodeBounds.minX >= obstacleBounds.minX - epsilon &&
          nodeBounds.maxX <= obstacleBounds.maxX + epsilon &&
          nodeBounds.minY >= obstacleBounds.minY - epsilon &&
          nodeBounds.maxY <= obstacleBounds.maxY + epsilon
        )
      })
    },
  )

  expect(nodesInsideComponentFootprint).toHaveLength(0)
})
