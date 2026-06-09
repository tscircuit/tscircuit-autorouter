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
  const topologyPlanningStepIndex = solver.pipelineDef.findIndex(
    (step) => step.solverName === "topologyPlanningSolver",
  )

  while (
    !solver.solved &&
    !solver.failed &&
    solver.currentPipelineStepIndex <= topologyPlanningStepIndex
  ) {
    solver.step()
  }

  expect(solver.failed).toBe(false)
  const componentDetectionOutput = solver.componentDetectionSolver!.getOutput()
  const topologyOutput = solver.topologyPlanningSolver!.getOutput()

  expect(
    componentDetectionOutput.components.map((component) => [
      component.componentId,
      component.componentKind,
      component.memberObstacles.length,
    ]),
  ).toEqual([["pcb_component_40", "qfp_thermalpad", 25]])
  expect(topologyOutput.componentMeshNodes.flat().length).toBeGreaterThan(0)
  expect(topologyOutput.mergedMeshNodes.length).toBeLessThan(2_000)
})
