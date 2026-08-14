import { sample001, sample004 } from "@tscircuit/dataset-srj29-ddr3-bga-pairs"
import { expect, test } from "bun:test"
import { Ddr3BgaRoutingPipelineSolver } from "fixtures/benchmarks/Ddr3BgaRoutingPipelineSolver"
import type { DetectedComponent } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import type { ConnectionPoint, SimpleRouteJson } from "lib/types"

function pointIsInsideComponent(
  point: ConnectionPoint,
  component: DetectedComponent,
): boolean {
  const { minX, maxX, minY, maxY } = component.bounds

  return (
    point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY
  )
}

test("detects and fans out both SRJ29 BGAs before starting Pipeline 7", () => {
  for (const inputSrj of [sample001, sample004] as SimpleRouteJson[]) {
    expect(inputSrj.connections).toHaveLength(50)
    expect(inputSrj.layerCount).toBeGreaterThanOrEqual(12)
    expect(
      inputSrj.obstacles.filter(
        (obstacle) => obstacle.componentId === "ddr3_bga",
      ),
    ).toHaveLength(96)
    expect(
      inputSrj.obstacles.filter(
        (obstacle) => obstacle.componentId === "controller_bga",
      ),
    ).toHaveLength(324)

    const pipeline = new Ddr3BgaRoutingPipelineSolver({ inputSrj })
    pipeline.solveUntilStage("autoroutingPipelineSolver")

    expect(pipeline.failed).toBe(false)
    expect(pipeline.getCurrentStageName()).toBe("autoroutingPipelineSolver")

    const detectedBgas = pipeline
      .componentDetectionSolver!.getOutput()
      .filter((component) => component.componentKind === "bga")
    expect(
      detectedBgas.map((component) => component.componentId).sort(),
    ).toEqual(["controller_bga", "ddr3_bga"])
    expect(pipeline.ddr3FanoutSolver!.getOutput().validation.valid).toBe(true)
    expect(pipeline.controllerFanoutSolver!.getOutput().validation.valid).toBe(
      true,
    )

    const fannedOutSrj =
      pipeline.controllerFanoutSolver!.getOutputSimpleRouteJson()
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
  }
})
