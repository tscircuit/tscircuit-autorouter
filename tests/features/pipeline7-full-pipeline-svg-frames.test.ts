import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import {
  getSolverSvgFrames,
  type SolverSvgFrame,
} from "../fixtures/solver-svg-frames"

const circuit003 = (dataset01 as Record<string, unknown>)
  .circuit003 as SimpleRouteJson

const frames: SolverSvgFrame[] = [
  { type: "step", step: 1 },
  { type: "pipeline", step: 3, view: "preview" },
  { type: "solver", solverName: "netToPointPairsSolver", step: "end" },
  { type: "solver", solverName: "topologyPlanningSolver", step: 1 },
  { type: "solver", solverName: "availableSegmentPointSolver", step: "end" },
  {
    type: "solver",
    solverName: "portPointPathingSolver",
    step: "start",
    view: "preview",
  },
  {
    type: "solver",
    solverName: "highDensityRouteSolver",
    step: 50,
  },
  { type: "solver", solverName: "traceSimplificationSolver", step: "end" },
  { type: "pipeline", step: "end" },
]

test("solver svg frames capture selected pipeline7 frames for a zero-drc circuit", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(circuit003),
    { cacheProvider: null },
  )

  const svg = getSolverSvgFrames({
    solver,
    frames,
    columns: 3,
  }).replace(/[ \t]+$/gm, "")

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  expect(solver.srjWithPointPairs).toBeDefined()
  const { errors } = evaluateRelaxedDrc({
    inputSrj: circuit003,
    srjWithPointPairs: solver.srjWithPointPairs!,
    traces: solver.getOutputSimplifiedPcbTraces(),
  })

  expect(errors).toHaveLength(0)
  expect(svg).toMatchSvgSnapshot(import.meta.path)
})
