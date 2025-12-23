import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver2_PortPointPathing } from "../../lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver2_PortPointPathing"
import type { SimpleRouteJson } from "lib/types"
import bugreport23 from "../../examples/bug-reports/bugreport23-LGA15x4/bugreport23-LGA15x4.srj.json"
import { convertSrjToGraphicsObject } from "lib/index"
import { stackGraphicsVertically } from "graphics-debug"
import kluer from "kleur"

test("bugreport23 - should not fail with null z property in port points", async () => {
  const solver = new AutoroutingPipelineSolver2_PortPointPathing(
    bugreport23 as unknown as SimpleRouteJson,
  )

  while (solver.getCurrentPhase() !== "portPointPathingSolver") {
    solver.step()
  }
  while (solver.getCurrentPhase() === "portPointPathingSolver") {
    solver.step()
  }
  solver.step()

  const ppps = solver.portPointPathingSolver
  const startTime = Date.now()
  const time = () => `${((Date.now() - startTime) / 1000).toFixed(2)}s`
  console.log(
    0,
    Date.now() - startTime,
    ppps!.computeBoardScore().toFixed(2),
    ppps?.iterations,
    time(),
  )
  // Print the board score after each activeSubSolver finishes

  const msppo = solver.multiSectionPortPointOptimizer
  if (msppo) {
    const ogViz = structuredClone(solver.portPointPathingSolver!.visualize())
    let bestScore = msppo!.computeBoardScore()
    console.log(0, bestScore.toFixed(2), kluer.red(msppo?.stats.errors))
    while (solver.getCurrentPhase() !== "highDensityRouteSolver") {
      solver.step()
      if (msppo?.activeSubSolver) {
        msppo.activeSubSolver.solve()
        solver.step()
        if (msppo.stats.currentBoardScore > bestScore) {
          bestScore = msppo.stats.currentBoardScore
          console.log(
            msppo.sectionAttempts,
            msppo.stats.currentBoardScore.toFixed(2),
            kluer.red(msppo?.stats.errors),
            time(),
          )
        }
      }
    }

    console.log(solver.multiSectionPortPointOptimizer?.stats)
    expect(
      stackGraphicsVertically([
        ogViz,
        solver.portPointPathingSolver!.visualize(),
      ]),
    ).toMatchGraphicsSvg(`${import.meta.path}-portPointPathingSolver`)
  }
})
