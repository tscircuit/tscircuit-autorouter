import { expect, test } from "bun:test"
import usbCPowerAdapterSrj from "./assets/usb-c-power-adapter.srj.json" with {
  type: "json",
}
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"

test("usb-c power adapter pipeline7 creates only supported component regions", () => {
  const srj = usbCPowerAdapterSrj as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver7_MultiGraph(srj, {
    cacheProvider: null,
  })
  const componentTopologyStepIndex = solver.pipelineDef.findIndex(
    (step) => step.solverName === "componentTopologyGeneratorSolver",
  )

  while (
    !solver.solved &&
    !solver.failed &&
    solver.currentPipelineStepIndex <= componentTopologyStepIndex
  ) {
    solver.step()
  }

  expect(solver.failed).toBe(false)
  const detectedComponents = solver.componentDetectionSolver!.getOutput()
  const componentMeshNodes =
    solver.componentTopologyGeneratorSolver!.getOutput()

  expect(
    detectedComponents.map((component) => [
      component.componentId,
      component.componentKind,
    ]),
  ).toEqual([["pcb_component_40", "qfp_thermalpad"]])
  expect(componentMeshNodes.length).toBeGreaterThan(0)
  expect(componentMeshNodes.length).toBeLessThan(2_000)
})
