import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { canShareLegacyDefaultCopper } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canShareLegacyDefaultCopper"
import type { SimpleRouteJson } from "lib/types"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("advisory layers do not waive declared copper-demand accounting", async (): Promise<void> => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top", pcb_port_id: "a" },
          { x: 2, y: 0, layer: "top", pcb_port_id: "b" },
        ],
      },
    ],
  }
  expect(canShareLegacyDefaultCopper(input)).toBeTrue()
  for (const field of [
    "nominalTraceWidth",
    "minViaDiameter",
    "minViaPadDiameter",
    "minViaHoleDiameter",
    "min_via_hole_diameter",
    "min_via_pad_diameter",
    "defaultObstacleMargin",
    "minTraceToPadEdgeClearance",
    "minTraceToHoleEdgeClearance",
    "minBoardEdgeClearance",
    "minViaHoleEdgeToViaHoleEdgeClearance",
    "minViaEdgeToPadEdgeClearance",
    "minPlatedHoleDrillEdgeToDrillEdgeClearance",
    "minPadEdgeToPadEdgeClearance",
  ] as const) {
    const declared = { ...input, [field]: 0.2 }
    expect(canShareLegacyDefaultCopper(declared)).toBeFalse()
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      declared,
      {
        cacheProvider: null,
      },
    )
    solver.solveUntilPhase("highDensityRouteSolver")
    expect(solver.failed, solver.error ?? "").toBeFalse()
    const [params] = solver.portPointPathingSolver!.getConstructorParams()
    expect(params.regionLayerMasksAreBinding).toBeFalse()
    expect(
      solver.portPointPathingSolver!.stats.sharedCopperCapacity,
    ).toBeFalse()
  }
  expect(
    canShareLegacyDefaultCopper({ ...input, minTraceToPadEdgeClearance: 0 }),
  ).toBeFalse()
  for (const width of [0.05, 0.1, 0.2]) {
    for (const field of ["width", "nominalTraceWidth"] as const) {
      expect(
        canShareLegacyDefaultCopper({
          ...input,
          connections: input.connections.map((connection) => ({
            ...connection,
            [field]: width,
          })),
        }),
      ).toBe(width <= input.minTraceWidth)
    }
    expect(
      canShareLegacyDefaultCopper({
        ...input,
        buses: [
          { busId: "signal", connectionNames: ["signal"], traceWidth: width },
        ],
      }),
    ).toBe(width <= input.minTraceWidth)
  }
  const { scenario: sample6 } = await loadScenarioBySampleNumber("srj18", 6)
  const { scenario: sample24 } = await loadScenarioBySampleNumber("srj24", 24)
  expect(canShareLegacyDefaultCopper(sample6)).toBeTrue()
  expect(canShareLegacyDefaultCopper(sample24)).toBeFalse()
})
