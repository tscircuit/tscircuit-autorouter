import type { AnyCircuitElement } from "circuit-json"
import sourcePads from "../fixtures/srj23-source-pad-metadata/sample007.json"
import { preparePostRoutingWholeNetInput } from "lib/solvers/PostRoutingOptimization/preparePostRoutingWholeNetInput"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const SAMPLE_NUMBERS = [1, 3, 7, 10]

test("Pipeline9 visually solves representative SRJ23 samples", async () => {
  for (const sampleNumber of SAMPLE_NUMBERS) {
    const { scenario, scenarioName } = await loadScenarioBySampleNumber(
      "srj23",
      sampleNumber,
    )
    const preloaded = preparePostRoutingWholeNetInput(
      scenario,
      scenario.traces ?? [],
      scenario.traces ?? [],
      [],
    )
    const fixedOwners = new Set(preloaded.traceOwners.values())
    const selectedNet =
      sampleNumber === 7
        ? preloaded.srj.connections.find((c) => !fixedOwners.has(c.name))!.name
        : scenario.connections[0]!.name
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      structuredClone(scenario),
      {
        postRoutingSourceCircuitJson:
          sampleNumber === 7 ? (sourcePads as AnyCircuitElement[]) : undefined,
        cacheProvider: null,
        effort: 1,
        visualizationTraceColorMode: "net",
        dynamicNetTreeRouting: {
          enabled: true,
          nets: [
            {
              net: selectedNet,
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
            maxExpansions: 150_000,
            maxMilliseconds: 2_500,
          },
        },
        postRoutingOptimization: {
          enabled: true,
          nets: [
            {
              net: selectedNet,
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
            maxExpansions: 150_000,
            maxMilliseconds: 2_500,
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

    const result = solver.getPostRoutingOptimizationResult()
    const diagnostic =
      solver.error?.replace(/[&<>]/g, " ") ??
      `${result?.status}: ${result?.diagnostics.join("; ")}; validation=${result?.validationStatus}`
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
        `<text x="12" y="28" font-size="12" fill="#9f1239">${diagnostic}</text></svg>`,
      ),
    ).toMatchSvgSnapshot(import.meta.path, {
      svgName: scenarioName,
      // Circuit 10 selects a different equal-cost route on Linux.
      tolerance: sampleNumber === 10 ? 0.035 : 0.01,
    })
    if (solveError) throw solveError
    expect(result?.validationStatus).toBe(
      sampleNumber === 7 ? "validated" : "unsupported",
    )
    if (result?.status !== "accepted")
      expect(result?.traces).toEqual([
        ...(
          solver.powerTraceExpansionSolver!.inputSrj as typeof scenario & {
            fixedTraces: NonNullable<typeof scenario.traces>
          }
        ).fixedTraces,
        ...solver.powerTraceExpansionSolver!.getOutput(),
      ])
    expect(scenario.traces?.length).toBeGreaterThan(0)
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
  }
})
