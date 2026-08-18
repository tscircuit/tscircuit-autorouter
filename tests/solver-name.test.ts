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

test("core autorouter exports have stable solver names", () => {
  expect(AssignableAutoroutingPipeline2.solverName).toBe(
    "AssignableAutoroutingPipeline2",
  )
  expect(AssignableAutoroutingPipeline3.solverName).toBe(
    "AssignableAutoroutingPipeline3",
  )
  expect(AutoroutingPipeline1_OriginalUnravel.solverName).toBe(
    "AutoroutingPipeline1_OriginalUnravel",
  )
  expect(AutoroutingPipelineSolver3_HgPortPointPathing.solverName).toBe(
    "AutoroutingPipelineSolver3_HgPortPointPathing",
  )
  expect(AutoroutingPipelineSolver4.solverName).toBe(
    "AutoroutingPipelineSolver4_TinyHypergraph",
  )
  expect(AutoroutingPipelineSolver5.solverName).toBe(
    "AutoroutingPipelineSolver5_HdCache",
  )
  expect(AutoroutingPipelineSolver.solverName).toBe(
    "AutoroutingPipelineSolver7_MultiGraph",
  )
  expect(AutoroutingPipelineSolver7_MultiGraph.solverName).toBe(
    "AutoroutingPipelineSolver7_MultiGraph",
  )
  expect(AutoroutingPipelineSolver8.solverName).toBe(
    "AutoroutingPipelineSolver8",
  )
  expect(AutoroutingPipelineSolver9_PreloadedTraceGraph.solverName).toBe(
    "AutoroutingPipelineSolver9_PreloadedTraceGraph",
  )
})
