import { expect, test } from "bun:test"
import {
  AssignableAutoroutingPipeline2,
  AssignableAutoroutingPipeline3,
  AutoroutingPipeline1_OriginalUnravel,
  AutoroutingPipelineSolver,
  AutoroutingPipelineSolver3_HgPortPointPathing,
  AutoroutingPipelineSolver4,
  AutoroutingPipelineSolver5,
  AutoroutingPipelineSolver7_MultiGraph,
  AutoroutingPipelineSolver8,
  AutoroutingPipelineSolver9_PreloadedTraceGraph,
} from "lib"

const getSolverName = (solverClass: {
  prototype: { getSolverName(): string }
}) => Object.create(solverClass.prototype).getSolverName()

test("core autorouter exports have stable solver names", () => {
  expect(getSolverName(AssignableAutoroutingPipeline2)).toBe(
    "AssignableAutoroutingPipeline2",
  )
  expect(getSolverName(AssignableAutoroutingPipeline3)).toBe(
    "AssignableAutoroutingPipeline3",
  )
  expect(getSolverName(AutoroutingPipeline1_OriginalUnravel)).toBe(
    "AutoroutingPipeline1_OriginalUnravel",
  )
  expect(getSolverName(AutoroutingPipelineSolver3_HgPortPointPathing)).toBe(
    "AutoroutingPipelineSolver3_HgPortPointPathing",
  )
  expect(getSolverName(AutoroutingPipelineSolver4)).toBe(
    "AutoroutingPipelineSolver4_TinyHypergraph",
  )
  expect(getSolverName(AutoroutingPipelineSolver5)).toBe(
    "AutoroutingPipelineSolver5_HdCache",
  )
  expect(getSolverName(AutoroutingPipelineSolver)).toBe(
    "AutoroutingPipelineSolver7_MultiGraph",
  )
  expect(getSolverName(AutoroutingPipelineSolver7_MultiGraph)).toBe(
    "AutoroutingPipelineSolver7_MultiGraph",
  )
  expect(getSolverName(AutoroutingPipelineSolver8)).toBe(
    "AutoroutingPipelineSolver8",
  )
  expect(getSolverName(AutoroutingPipelineSolver9_PreloadedTraceGraph)).toBe(
    "AutoroutingPipelineSolver9_PreloadedTraceGraph",
  )
})
