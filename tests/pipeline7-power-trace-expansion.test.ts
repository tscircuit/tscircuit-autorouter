import { expect, test } from "bun:test"
import { sample001 } from "@tscircuit/dataset-srj27-power-traces"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { PowerTraceExpansionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/PowerTraceExpansionSolver"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"

test(
  "Pipeline7 opt-in power expansion keeps sample001 on top without DRC errors",
  () => {
    const input = structuredClone(sample001) as unknown as SimpleRouteJson
    const defaultPipeline = new AutoroutingPipelineSolver7_MultiGraph(input, {
      cacheProvider: null,
    })
    expect(defaultPipeline.pipelineDef.at(-1)?.solverName).toBe(
      "postProcessingSolver",
    )

    const enabledPipeline = new AutoroutingPipelineSolver7_MultiGraph(input, {
      cacheProvider: null,
      powerTraceExpansion: { onlyConnectionNames: ["source_net_3"] },
    })
    expect(enabledPipeline.pipelineDef.at(-1)?.solverName).toBe(
      "powerTraceExpansionSolver",
    )

    const solver = new PowerTraceExpansionSolver(input, {
      onlyConnectionNames: ["source_net_3"],
    })
    solver.solve()

    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)
    expect(solver.iterations).toBeLessThan(3_000_000)

    const output = solver.getOutput()
    const reproducedTrace = output.find(
      (trace) => trace.pcb_trace_id === "source_net_3_mst10_0",
    )
    expect(reproducedTrace).toBeDefined()
    expect(
      reproducedTrace!.route.filter((point) => point.route_type === "via"),
    ).toEqual([])
    expect(
      new Set(
        reproducedTrace!.route.flatMap((point) =>
          point.route_type === "wire" ? [point.layer] : [],
        ),
      ),
    ).toEqual(new Set(["top"]))
    expect(
      output
        .flatMap((trace) => trace.route)
        .some(
          (point) =>
            point.route_type === "wire" && point.width > input.minTraceWidth,
        ),
    ).toBe(true)

    const graphics = solver.visualize()
    expect(graphics.rects?.length).toBeGreaterThan(0)
    expect(
      new Set(
        graphics.lines?.flatMap((line) =>
          line.layer ? [String(line.layer)] : [],
        ),
      ),
    ).toEqual(new Set(["z0", "z1"]))

    const circuitJson = convertToCircuitJson(
      { ...input, traces: output },
      output,
      {
        minTraceWidth: input.minTraceWidth,
        originalSrj: input,
        includeOriginalConnections: true,
      },
    )
    expect(getDrcErrors(circuitJson).errors).toEqual([])
  },
  60_000,
)
