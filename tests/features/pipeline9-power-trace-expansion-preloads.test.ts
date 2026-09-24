import { expect, test } from "bun:test"
import type { PowerTraceExpanderOptions } from "@tscircuit/power-trace-expander"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { PowerTraceExpansionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/PowerTraceExpansionSolver"
import type { Pipeline7PowerTraceExpansionInput } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/prepare-pipeline7-power-trace-expansion-input"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
  SimplifiedPcbTraces,
} from "lib/types"

const createTrace = (
  pcbTraceId: string,
  connectionName: string,
  y: number,
): SimplifiedPcbTrace => ({
  type: "pcb_trace",
  pcb_trace_id: pcbTraceId,
  connection_name: connectionName,
  route: [
    { route_type: "wire", x: 0, y, width: 0.15, layer: "top" },
    { route_type: "wire", x: 10, y, width: 0.15, layer: "top" },
  ],
})

test("Pipeline9 power expansion uses current preloads without disabling its stage", () => {
  const originalPowerTrace = createTrace("power-preload", "POWER", 0)
  const originalSignalTrace = createTrace("signal-preload", "SIGNAL", 2)
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -1, minY: -1, maxX: 11, maxY: 4 },
    obstacles: [],
    connections: [
      {
        name: "POWER",
        nominalTraceWidth: 0.6,
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 10, y: 0, layer: "top" },
        ],
      },
      {
        name: "SIGNAL",
        pointsToConnect: [
          { x: 0, y: 2, layer: "top" },
          { x: 10, y: 2, layer: "top" },
        ],
      },
    ],
    traces: [originalPowerTrace, originalSignalTrace],
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj)
  const updatedPowerTrace = {
    ...createTrace("power-preload", "POWER", 1),
    __replaces_pcb_trace_id: "power-preload",
  }
  const updatedSignalTrace = {
    ...createTrace("signal-preload", "SIGNAL", 2.5),
    __replaces_pcb_trace_id: "signal-preload",
  }
  const newlyRoutedTraces: SimplifiedPcbTraces = [
    createTrace("new-route", "NEW", 3),
  ]
  const powerStep = solver.pipelineDef.at(-1)!

  expect(() => solver.getOutputSimplifiedPcbTraces()).toThrow(
    "Cannot get output before solving is complete",
  )
  expect(() => solver.getOutputSimpleRouteJson()).toThrow(
    "Cannot get output before solving is complete",
  )
  expect(powerStep.solverName).toBe("powerTraceExpansionSolver")
  expect(solver.pipelineDef.at(-2)?.solverName).toBe(
    "lengthMatchingPostProcessingSolver",
  )
  solver.getNewTracesBeforePowerExpansion = () => newlyRoutedTraces
  solver.getUpdatedPreloadedTraces = () => [
    updatedPowerTrace,
    updatedSignalTrace,
  ]
  const [rawInput, options] = powerStep.getConstructorParams(solver)
  const input = rawInput as Pipeline7PowerTraceExpansionInput

  expect(options as PowerTraceExpanderOptions).toMatchObject({
    allowNewVias: false,
    onlyConnectionNames: ["POWER"],
  })
  expect(input.fixedTraces).toEqual([updatedSignalTrace])
  expect(input.traces).toHaveLength(2)
  expect(input.traces?.[0]).toEqual(newlyRoutedTraces[0])
  expect(input.traces?.[1]).toMatchObject({
    pcb_trace_id: "power-preload",
    connection_name: "POWER",
    __replaces_pcb_trace_id: "power-preload",
  })
  expect(input.traces?.[1]?.route[0]).toMatchObject({ y: 1 })

  const expansionSolver = new PowerTraceExpansionSolver(
    input,
    options as PowerTraceExpanderOptions,
  )
  expansionSolver.solve()
  expect(expansionSolver.failed).toBeFalse()
  solver.powerTraceExpansionSolver = expansionSolver
  solver.solved = true

  const simplifiedOutput = solver.getOutputSimplifiedPcbTraces()
  const completeOutput = solver.getOutputSimpleRouteJson().traces ?? []
  expect(simplifiedOutput).toHaveLength(3)
  expect(completeOutput).toHaveLength(3)
  expect(new Set(completeOutput.map((trace) => trace.pcb_trace_id)).size).toBe(
    completeOutput.length,
  )
  expect(
    completeOutput.filter(
      (trace) => trace.__replaces_pcb_trace_id === "power-preload",
    ),
  ).toHaveLength(1)
})
