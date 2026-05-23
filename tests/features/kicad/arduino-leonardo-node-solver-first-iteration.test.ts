import { expect, test } from "bun:test"
import { join } from "node:path"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { convertKicadPcbFileToSimpleRouteJson } from "tests/fixtures/kicadPcbToSimpleRouteJson"

const kicadPcbPath = join(import.meta.dir, "assets/arduino-leonardo.kicad_pcb")

const runUntilNodeSolverFirstSeedingIteration = (
  solver: AutoroutingPipelineSolver4,
) => {
  const maxPipelineSteps = 20_000

  for (let i = 0; i < maxPipelineSteps; i++) {
    const seedSolver =
      solver.nodeSolver?.rectDiffGridSolverPipeline?.rectDiffSeedingSolver
    if (solver.getCurrentPhase() === "nodeSolver" && seedSolver) {
      if (seedSolver.iterations >= 1) return
    }

    solver.step()

    if (solver.failed || solver.solved) break
  }

  throw new Error(
    `Expected nodeSolver first iteration, got phase=${solver.getCurrentPhase()} solved=${solver.solved} failed=${solver.failed} error=${solver.error}`,
  )
}

test("Arduino Leonardo KiCad PCB nodeSolver first iteration snapshot", () => {
  const { circuitJson, simpleRouteJson, warnings, stats } =
    convertKicadPcbFileToSimpleRouteJson(kicadPcbPath)

  expect(warnings).toHaveLength(0)
  expect(stats.traces).toBeGreaterThan(0)
  expect(circuitJson.some((element) => element.type === "pcb_board")).toBe(true)

  expect(simpleRouteJson.connections.length).toBeGreaterThan(0)
  expect(simpleRouteJson.obstacles.length).toBeGreaterThan(0)

  const solver = new AutoroutingPipelineSolver4(simpleRouteJson, {
    cacheProvider: null,
  })
  runUntilNodeSolverFirstSeedingIteration(solver)

  expect(solver.getCurrentPhase()).toBe("nodeSolver")
  expect(
    solver.nodeSolver?.rectDiffGridSolverPipeline?.rectDiffSeedingSolver
      ?.iterations,
  ).toBe(1)
  expect(
    getSvgFromGraphicsObject(solver.nodeSolver!.visualize()),
  ).toMatchSvgSnapshot(import.meta.path)
}, 120_000)
