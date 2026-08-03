import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"
import baseSrj from "../../fixtures/bug-reports/issue1801-terminal-orientation/issue1801-terminal-orientation.srj.json"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const getSrjForC5X = (c5X: number) => {
  const srj = structuredClone(baseSrj)
  const deltaX = c5X - 9

  for (const obstacle of srj.obstacles) {
    if (obstacle.center.x === 8.0875 || obstacle.center.x === 9.9125) {
      obstacle.center.x += deltaX
    }
  }

  for (const connection of srj.connections) {
    for (const point of connection.pointsToConnect) {
      if (
        point.pcb_port_id === "pcb_port_10" ||
        point.pcb_port_id === "pcb_port_11"
      ) {
        point.x += deltaX
      }
    }
  }

  return srj as SimpleRouteJson
}

test("reproduces issue 1801 while moving C5 to x=10", () => {
  let failingSolver: AutoroutingPipelineSolver7_MultiGraph | undefined

  for (let c5XTenth = 90; c5XTenth <= 100; c5XTenth++) {
    const c5X = c5XTenth / 10
    const solver = new AutoroutingPipelineSolver7_MultiGraph(getSrjForC5X(c5X))

    try {
      solver.solve()
    } catch (error) {
      if (!solver.failed) throw error
    }

    if (c5X === 10) failingSolver = solver
  }

  expect(failingSolver).toBeDefined()
  if (!failingSolver) throw new Error("C5 x=10 placement was not exercised")

  expect(failingSolver.failed).toBe(true)
  expect(String(failingSolver.error)).toContain(
    "terminal identity disagrees with route orientation",
  )
  expect(getLastStepSvg(failingSolver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
