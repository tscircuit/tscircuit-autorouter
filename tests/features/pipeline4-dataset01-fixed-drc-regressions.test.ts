import { describe, expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { addVisualizationToLastStep } from "lib/utils/addVisualizationToLastStep"
import type { GraphicsObject } from "graphics-debug"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "tests/fixtures/getLastStepSvg"

const fixedDrcSamples = [
  { sampleNumber: 39, circuitKey: "circuit123" },
  { sampleNumber: 61, circuitKey: "circuit145" },
  { sampleNumber: 64, circuitKey: "circuit148" },
  { sampleNumber: 71, circuitKey: "circuit156" },
  { sampleNumber: 73, circuitKey: "circuit158" },
  { sampleNumber: 83, circuitKey: "circuit173" },
  { sampleNumber: 96, circuitKey: "circuit187" },
  { sampleNumber: 98, circuitKey: "circuit189" },
] as const

type LocationAwareDrcError = ReturnType<
  typeof getDrcErrors
>["locationAwareErrors"][number]

const createDrcErrorVisualization = (
  locationAwareErrors: LocationAwareDrcError[],
): GraphicsObject => ({
  circles: locationAwareErrors.map((error) => ({
    center: error.center,
    radius: 0.75,
    fill: "rgba(255, 0, 0, 0.3)",
    layer: "drc",
    stroke: "red",
    strokeWidth: 0.1,
    label: error.message,
  })),
  points: locationAwareErrors.map((error) => ({
    x: error.center.x,
    y: error.center.y,
    color: "red",
    size: 10,
    layer: "drc",
    label: error.message,
  })),
  lines: locationAwareErrors.flatMap((error) => [
    {
      points: [
        { x: error.center.x - 0.5, y: error.center.y - 0.5 },
        { x: error.center.x - 0.4, y: error.center.y - 0.4 },
      ],
      layer: "drc",
      strokeColor: "red",
      strokeWidth: 0.05,
    },
    {
      points: [
        { x: error.center.x + 0.5, y: error.center.y + 0.5 },
        { x: error.center.x + 0.4, y: error.center.y + 0.4 },
      ],
      layer: "drc",
      strokeColor: "red",
      strokeWidth: 0.05,
    },
    {
      points: [
        { x: error.center.x - 0.5, y: error.center.y + 0.5 },
        { x: error.center.x - 0.4, y: error.center.y + 0.4 },
      ],
      layer: "drc",
      strokeColor: "red",
      strokeWidth: 0.05,
    },
    {
      points: [
        { x: error.center.x + 0.5, y: error.center.y - 0.5 },
        { x: error.center.x + 0.4, y: error.center.y - 0.4 },
      ],
      layer: "drc",
      strokeColor: "red",
      strokeWidth: 0.05,
    },
  ]),
})

describe("pipeline4 dataset01 fixed DRC regressions", () => {
  for (const { sampleNumber, circuitKey } of fixedDrcSamples) {
    test(
      `sample ${sampleNumber} (${circuitKey}) routes with no relaxed DRC errors`,
      async () => {
        const srj = (dataset01 as Record<string, unknown>)[circuitKey] as
          | SimpleRouteJson
          | undefined

        expect(srj).toBeDefined()

        const solver = new AutoroutingPipelineSolver4(structuredClone(srj!))
        solver.solve()

        expect(solver.solved).toBe(true)
        expect(solver.failed).toBe(false)

        const srjWithPointPairs = solver.srjWithPointPairs
        if (!srjWithPointPairs) {
          throw new Error(
            `Solver did not produce point pairs SRJ for dataset01 sample ${sampleNumber} (${circuitKey})`,
          )
        }

        const circuitJson = convertToCircuitJson(
          srjWithPointPairs,
          solver.getOutputSimplifiedPcbTraces(),
          srj!.minTraceWidth,
          srj!.minViaDiameter,
        )
        const { errors, locationAwareErrors } = getDrcErrors(
          circuitJson,
          RELAXED_DRC_OPTIONS,
        )

        const visualizationWithDrc = addVisualizationToLastStep(
          solver.visualize(),
          createDrcErrorVisualization(locationAwareErrors),
        )

        await expect(getLastStepSvg(visualizationWithDrc)).toMatchSvgSnapshot(
          import.meta.path,
          {
            svgName: `sample-${sampleNumber}-${circuitKey}-visual-drc`,
            tolerance: 0.1,
          },
        )

        expect(errors.map((error) => error.message)).toEqual([])
      },
      { timeout: 120_000 },
    )
  }
})
