import { getSvgFromGraphicsObject } from "graphics-debug"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const SAMPLE_NUMBERS = [1, 3, 10]

test("Pipeline9 visually solves representative SRJ23 samples", async () => {
  for (const sampleNumber of SAMPLE_NUMBERS) {
    const { scenario, scenarioName } = await loadScenarioBySampleNumber(
      "srj23",
      sampleNumber,
    )
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      structuredClone(scenario),
      {
        cacheProvider: null,
        effort: 1,
        visualizationTraceColorMode: "net",
        postRoutingOptimization: {
          enabled: true,
          nets: [
            {
              net: scenario.connections[0]!.name,
              maxNewVias: 2,
              maxNewViasPerBranch: 1,
            },
          ],
          objective: {
            priorities: ["viaSites", "copperLength", "bends"],
            maxCopperLengthIncrease: 0,
            maxBendIncrease: 0,
            maxChangedNets: 1,
          },
          search: {
            gridStep: 0.5,
            viaCost: 3,
            bendCost: 0.05,
            maxExpansions: 300_000,
            maxMilliseconds: 5_000,
          },
        },
      },
    )

    let solveError: unknown
    try {
      solver.solve()
    } catch (error) {
      solveError = error
    }

    await expect(
      (solver.failed
        ? getSvgFromGraphicsObject(
            convertSrjToGraphicsObject(
              {
                ...scenario,
                traces: [
                  ...(
                    solver.powerTraceExpansionSolver!
                      .inputSrj as typeof scenario & {
                      fixedTraces: typeof scenario.traces
                    }
                  ).fixedTraces!,
                  ...solver.powerTraceExpansionSolver!.getOutput(),
                ],
              },
              { traceColorMode: "net" },
            ),
            { backgroundColor: "white" },
          )
        : getLastStepSvg(solver.visualize())
      ).replace(
        "</svg>",
        `<text x="12" y="28" font-size="12" fill="#9f1239">${solver.error?.replace(/[&<>]/g, " ") ?? "Post-routing phase completed"}</text></svg>`,
      ),
    ).toMatchSvgSnapshot(import.meta.path, {
      svgName: scenarioName,
      // Circuit 10 selects a different equal-cost route on Linux.
      tolerance: sampleNumber === 10 ? 0.035 : 0.01,
    })
    if (solveError) throw solveError
    expect(scenario.traces?.length).toBeGreaterThan(0)
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
  }
})
