import { beforeAll, expect, test } from "bun:test"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { stackSvgsHorizontally } from "stack-svgs"
import { blockedBoard } from "../fixtures/phase-wait/blockedBoard"
import {
  getPhaseWaitState,
  observePhaseWait,
  type PhaseWaitObservation,
  type PhaseWaitState,
} from "../fixtures/phase-wait/observePhaseWait"

let waits: PhaseWaitObservation[]
let terminalState: PhaseWaitState

beforeAll(async (): Promise<void> => {
  // Establish the real failure independently of solveUntilPhase and its guard.
  const baseline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(blockedBoard),
    { effort: 0.1, cacheProvider: null },
  )
  baseline.solve()
  expect(baseline.failed).toBe(true)
  expect(baseline.solved).toBe(false)
  expect(baseline.getCurrentPhase()).toBe("portPointPathingSolver")
  expect(baseline.error).toContain("no legal path")
  terminalState = getPhaseWaitState(baseline)
  expect(baseline.portPointPathingSolver!.failed).toBe(true)
  expect(baseline.highDensityRouteSolver).toBeUndefined()

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(blockedBoard),
    { effort: 0.1, cacheProvider: null },
  )
  waits = [
    observePhaseWait(solver, "highDensityRouteSolver"),
    observePhaseWait(solver, "highDensityRouteSolver"),
  ]
  for (const wait of waits) expect(wait.after).toEqual(terminalState)

  // Removing only the blocker must make the requested phase reachable.
  const controlBoard = { ...structuredClone(blockedBoard), obstacles: [] }
  const control = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    controlBoard,
    { effort: 0.1, cacheProvider: null },
  )
  const controlWait = observePhaseWait(control, "highDensityRouteSolver")
  expect(controlWait.error).toBeNull()
  expect(controlWait.terminalStepCalls).toBe(0)
  expect(controlWait.after).toMatchObject({
    phase: "highDensityRouteSolver",
    failed: false,
    solved: false,
  })

  const panels = [
    { solver: baseline, board: blockedBoard, title: "Blocked: no legal path" },
    {
      solver: control,
      board: controlBoard,
      title: "Control: blocker removed, requested phase reached",
    },
  ].map(({ solver: panelSolver, board, title }, index): string => {
    const pathing = panelSolver.portPointPathingSolver!.visualize()
    const graphics: GraphicsObject = {
      ...pathing,
      rects: [...(pathing.rects ?? []), ...convertSrjToGraphicsObject(board).rects],
      lines: [
        ...(pathing.lines ?? []),
        {
          points: [
            { x: -8, y: -2 },
            { x: 8, y: -2 },
            { x: 8, y: 2 },
            { x: -8, y: 2 },
            { x: -8, y: -2 },
          ],
          strokeColor: "#334155",
          strokeWidth: 0.04,
        },
      ],
      texts: [
        { x: 0, y: 6.2, text: title, fontSize: 0.4 },
        {
          x: 0,
          y: -6,
          text: `Stopped at: ${panelSolver.getCurrentPhase()}`,
          fontSize: 0.35,
        },
        {
          x: 0,
          y: -7,
          text: `Terminal steps (first / repeated): ${index === 0 ? waits.map((wait) => wait.terminalStepCalls).join(" / ") : controlWait.terminalStepCalls}`,
          fontSize: 0.35,
        },
        {
          x: 0,
          y: -8,
          text: index === 0
            ? `Caller receives solver error (first / repeated): ${waits.map((wait) => wait.error instanceof Error && wait.error.message === terminalState.error).join(" / ")}`
            : "Caller returns successfully",
          fontSize: 0.35,
        },
      ],
    }
    return getSvgFromGraphicsObject(graphics, {
      backgroundColor: "white",
      svgWidth: 720,
      svgHeight: 560,
    })
  })
  // Snapshot failures must not be swallowed by test.failing.
  const svg = stackSvgsHorizontally(panels, { gap: 16 }).replace(/[ \t]+$/gm, "")
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})

test.failing("blocked-board phase waits preserve the real failure without terminal steps", (): void => {
  expect(
    waits.map((wait) => ({
      error: wait.error,
      stepCalls: wait.stepCalls,
      terminalStepCalls: wait.terminalStepCalls,
      state: wait.after,
    })),
  ).toEqual([
    {
      error: new Error(terminalState.error!),
      stepCalls: terminalState.iterations,
      terminalStepCalls: 0,
      state: terminalState,
    },
    {
      error: new Error(terminalState.error!),
      stepCalls: 0,
      terminalStepCalls: 0,
      state: terminalState,
    },
  ])
})
