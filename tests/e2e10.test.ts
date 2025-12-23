import { expect, test } from "bun:test"
import { AssignableAutoroutingPipeline2 } from "../lib/autorouter-pipelines/AssignableAutoroutingPipeline2/AssignableAutoroutingPipeline2"
import { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "../lib"
import e2e10 from "examples/legacy/assets/e2e10.json"

test.skip("should solve e2e10 board using AssignableAutoroutingPipeline2", async () => {
  const simpleSrj: SimpleRouteJson = e2e10 as any

  const solver = new AssignableAutoroutingPipeline2(simpleSrj)

  while (solver.iterations < 80e3 && !solver.solved && !solver.failed) {
    solver.step()
    if (solver.iterations % 1000 === 0) {
      console.log(solver.iterations, solver.getCurrentPhase())
    }
  }

  expect(solver.solved).toBe(true)

  const result = solver.getOutputSimpleRouteJson()
  expect(convertSrjToGraphicsObject(result)).toMatchGraphicsSvg(
    import.meta.path,
  )
}, 60_000)
