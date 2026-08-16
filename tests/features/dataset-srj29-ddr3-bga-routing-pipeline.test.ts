import { sample001 } from "@tscircuit/dataset-srj29-ddr3-bga-pairs"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver10_BgaFanout } from "lib/autorouter-pipelines/AutoroutingPipeline10_BgaFanout/AutoroutingPipelineSolver10_BgaFanout"
import type { DetectedComponent } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import type { ConnectionPoint, SimpleRouteJson } from "lib/types"

type Srj29Metadata = {
  referenceDesign: {
    directConnectionCount: number
  }
  ddr3: { padCount: number }
  controller: { padCount: number }
}

function pointIsInsideComponent(
  point: ConnectionPoint,
  component: DetectedComponent,
): boolean {
  const { minX, maxX, minY, maxY } = component.bounds

  return (
    point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY
  )
}

test("Pipeline 10 detects and fans out both SRJ29 BGAs before Pipeline 9", () => {
  const inputSrj = sample001 as SimpleRouteJson
  const metadata = (inputSrj as SimpleRouteJson & { metadata: Srj29Metadata })
    .metadata

  expect(inputSrj.connections).toHaveLength(
    metadata.referenceDesign.directConnectionCount,
  )
  expect(inputSrj.layerCount).toBeGreaterThanOrEqual(18)
  expect(
    inputSrj.obstacles.filter(
      (obstacle) => obstacle.componentId === "ddr3_bga",
    ),
  ).toHaveLength(metadata.ddr3.padCount)
  expect(
    inputSrj.obstacles.filter(
      (obstacle) => obstacle.componentId === "controller_bga",
    ),
  ).toHaveLength(metadata.controller.padCount)

  const pipeline = new AutoroutingPipelineSolver10_BgaFanout(inputSrj)
  pipeline.solveUntilStage("autoroutingPipelineSolver")

  expect(pipeline.failed).toBe(false)
  expect(pipeline.getCurrentStageName()).toBe("autoroutingPipelineSolver")

  const detectedBgas = pipeline
    .componentDetectionSolver!.getOutput()
    .filter((component) => component.componentKind === "bga")
  expect(detectedBgas.map((component) => component.componentId).sort()).toEqual(
    ["controller_bga", "ddr3_bga"],
  )
  expect(pipeline.firstBgaFanoutSolver!.getOutput().validation.valid).toBe(true)
  expect(pipeline.secondBgaFanoutSolver!.getOutput().validation.valid).toBe(
    true,
  )

  const fannedOutSrj =
    pipeline.secondBgaFanoutSolver!.getOutputSimpleRouteJson()
  expect(fannedOutSrj.traces!.length).toBeGreaterThanOrEqual(
    inputSrj.connections.length * 2,
  )
  for (const connection of fannedOutSrj.connections) {
    expect(
      connection.pointsToConnect.every((point) =>
        detectedBgas.every(
          (component) => !pointIsInsideComponent(point, component),
        ),
      ),
    ).toBe(true)
  }

  pipeline.step()
  pipeline.step()
  expect(pipeline.autoroutingPipelineSolver).toBeDefined()
  expect(
    pipeline.autoroutingPipelineSolver!.autoroutingPipelineSolver.iterations,
  ).toBe(1)
})
