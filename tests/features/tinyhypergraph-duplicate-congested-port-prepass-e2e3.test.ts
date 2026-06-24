import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver7_MultiGraph as Pipeline7 } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"
import e2e3Fixture from "../../fixtures/legacy/assets/e2e3.json"

const MAX_STEPS_TO_ACTIVE_DUPLICATE_ROUTE = 10_000

test("snapshots e2e3 duplicate congested port prepass", () => {
  const pipelineSolver = new Pipeline7(e2e3Fixture as SimpleRouteJson, {
    cacheProvider: null,
  })
  pipelineSolver.solveUntilPhase("portPointPathingSolver")
  pipelineSolver.step()

  const portPointSolver = pipelineSolver.portPointPathingSolver!
  for (
    let stepIndex = 0;
    stepIndex < MAX_STEPS_TO_ACTIVE_DUPLICATE_ROUTE;
    stepIndex++
  ) {
    const activeRouteSolver =
      portPointSolver.duplicateCongestedPortPrepassSolver?.activeSubSolver
        ?.activeSubSolver
    if (activeRouteSolver) break
    portPointSolver.step()
  }

  const prepassSolver = portPointSolver.duplicateCongestedPortPrepassSolver
  const activeRouteSolver = prepassSolver?.activeSubSolver?.activeSubSolver
  expect(activeRouteSolver).toBeTruthy()

  const activeRouteSvg = getSvgFromGraphicsObject(prepassSolver!.visualize(), {
    backgroundColor: "white",
  })
  expect(activeRouteSvg).toMatchSvgSnapshot(import.meta.path)
}, 20_000)
