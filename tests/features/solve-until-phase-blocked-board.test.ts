import { beforeAll, expect, spyOn, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { blockedBoard } from "../fixtures/phase-wait/blockedBoard"

const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
  structuredClone(blockedBoard),
  { effort: 0.1, cacheProvider: null },
)
let waitError: unknown
let terminalSteps = 0

beforeAll(async (): Promise<void> => {
  const step = solver.step.bind(solver)
  const guardedStep = spyOn(solver, "step").mockImplementation((): void => {
    // Interrupt the first no-op terminal step so a regression cannot hang CI.
    if (solver.failed || solver.solved) {
      terminalSteps++
      throw new Error("phase wait attempted to step a terminal solver")
    }
    step()
  })
  try {
    solver.solveUntilPhase("highDensityRouteSolver")
  } catch (error) {
    waitError = error
  } finally {
    guardedStep.mockRestore()
  }
  expect(solver.failed).toBe(true)
  expect(solver.error).toContain("no legal path")

  // Snapshot failures must not be swallowed by test.failing.
  await expect(
    getSvgFromGraphicsObject(
      {
        ...convertSrjToGraphicsObject(blockedBoard),
        texts: [
          {
            x: 0,
            y: 6.5,
            text: "Six-layer board: signal blocked on every copper layer",
            fontSize: 0.4,
          },
          {
            x: 0,
            y: -6,
            text: `Terminal steps attempted: ${terminalSteps}`,
            fontSize: 0.4,
          },
          {
            x: 0,
            y: -7,
            text: `Caller receives solver error: ${waitError instanceof Error && waitError.message === solver.error}`,
            fontSize: 0.4,
          },
        ],
      },
      { backgroundColor: "white", svgWidth: 800, svgHeight: 560 },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})

test.failing("phase wait propagates the blocked board failure without stepping again", (): void => {
  expect(waitError).toBeInstanceOf(Error)
  expect((waitError as Error).message).toBe(solver.error!)
  expect(terminalSteps).toBe(0)
})
