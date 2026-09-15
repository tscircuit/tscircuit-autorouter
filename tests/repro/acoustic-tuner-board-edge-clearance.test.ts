import { expect, test } from "bun:test"
import { checkCopperToBoardEdgeClearance } from "@tscircuit/checks"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { AnyCircuitElement, PcbBoard, PcbVia } from "circuit-json"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import input from "../../fixtures/repro/acoustic-tuner-board-edge-clearance/input.srj.json"

type Point = { x: number; y: number }
type ViaMeasurement = Point & { diameter: number; clearance: number }

const srj = input as SimpleRouteJson
const connectionName = "source_trace_67"

function measureVia(
  point: Point,
  diameter: number,
  outline: Point[],
): ViaMeasurement {
  const centerToEdge = Math.min(
    ...outline.map((start, index): number =>
      pointToSegmentDistance(
        point,
        start,
        outline[(index + 1) % outline.length],
      ),
    ),
  )
  return {
    x: point.x,
    y: point.y,
    diameter,
    clearance: centerToEdge - diameter / 2,
  }
}

function measureNeckVia(routes: HighDensityRoute[]): ViaMeasurement {
  const route = routes.find(
    (candidate): boolean => candidate.connectionName === connectionName,
  )
  if (!route) throw new Error(`Missing route ${connectionName}`)
  const via = route.vias.find((point): boolean => point.y > 10 && point.y < 26)
  if (!via) throw new Error(`Missing neck via on ${connectionName}`)
  return measureVia(via, route.viaDiameter, input.outline)
}

test("Pipeline 9 reproduces a via-to-board clearance violation after global repair", (): void => {
  expect(input.minBoardEdgeClearance).toBe(0.3)
  expect(input.minViaPadDiameter).toBe(0.6)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    { cacheProvider: null },
  )
  let beforeRepair: ViaMeasurement | undefined
  let afterRepair: ViaMeasurement | undefined

  // Copy measurements at the stage boundaries, before later solvers run.
  while (!solver.solved && !solver.failed) {
    solver.step()
    const repair = solver.globalDrcForceImproveSolver
    if (repair && beforeRepair === undefined) {
      beforeRepair = measureNeckVia(repair.inputHdRoutes)
    }
    if (repair?.solved && afterRepair === undefined) {
      afterRepair = measureNeckVia(repair.getOutput())
    }
  }

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  if (!beforeRepair || !afterRepair) {
    throw new Error("Global repair did not produce both measurements")
  }
  expect(beforeRepair.diameter).toBe(0.6)
  expect(beforeRepair.clearance).toBeGreaterThanOrEqual(
    input.minBoardEdgeClearance,
  )
  expect(beforeRepair.clearance).toBeCloseTo(0.300001, 6)
  expect(afterRepair.clearance).toBeCloseTo(0.2611598809, 6)

  const violations: (ViaMeasurement & { connectionName: string })[] = []
  for (const trace of solver.getOutputSimplifiedPcbTraces()) {
    for (const point of trace.route) {
      if (point.route_type !== "via") continue
      const measurement = measureVia(
        point,
        point.via_diameter ?? input.minViaPadDiameter,
        input.outline,
      )
      if (measurement.clearance < input.minBoardEdgeClearance - 1e-6) {
        violations.push({
          ...measurement,
          connectionName: trace.connection_name,
        })
      }
    }
  }

  // This is a reproduction of the current defect, not an assertion of safety.
  // A fix should replace this expectation with expect(violations).toEqual([]).
  expect(violations).toHaveLength(1)
  const finalVia = violations[0]
  expect(finalVia.connectionName).toBe(connectionName)
  expect(finalVia.x).toBeCloseTo(afterRepair.x, 6)
  expect(finalVia.y).toBeCloseTo(afterRepair.y, 6)
  expect(finalVia.diameter).toBe(0.6)
  expect(finalVia.clearance).toBeCloseTo(afterRepair.clearance, 6)

  // Independently confirm the gap with the official copper-to-board check.
  const board: PcbBoard = {
    type: "pcb_board",
    pcb_board_id: "tuner_board",
    center: { x: 0, y: 0 },
    width: input.bounds.maxX - input.bounds.minX,
    height: input.bounds.maxY - input.bounds.minY,
    thickness: 1.6,
    material: "fr4",
    num_layers: input.layerCount,
    outline: input.outline,
    min_board_edge_clearance: input.minBoardEdgeClearance,
  }
  const via: PcbVia = {
    type: "pcb_via",
    pcb_via_id: "tuner_neck_via",
    pcb_trace_id: connectionName,
    x: finalVia.x,
    y: finalVia.y,
    outer_diameter: finalVia.diameter,
    hole_diameter: input.minViaHoleDiameter,
    layers: ["top", "bottom"],
  }
  expect(checkCopperToBoardEdgeClearance([board, via])).toHaveLength(1)
  expect(
    checkCopperToBoardEdgeClearance([
      board,
      { ...via, x: beforeRepair.x, y: beforeRepair.y },
    ]),
  ).toEqual([])

  // Keep the saved full-board picture tied to the fresh router's emitted copper.
  const capturedCircuit = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "./assets/acoustic-tuner-rerouted-board.circuit.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as AnyCircuitElement[]
  const capturedTraces = capturedCircuit.filter(
    (element) => element.type === "pcb_trace",
  )
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  expect(capturedTraces).toHaveLength(routedTraces.length)
  for (const trace of routedTraces) {
    const captured = capturedTraces.find(
      (element) => element.pcb_trace_id === trace.pcb_trace_id,
    )
    if (!captured)
      throw new Error(`Missing captured trace ${trace.pcb_trace_id}`)
    expect(captured.route).toHaveLength(trace.route.length)
    for (let index = 0; index < trace.route.length; index++) {
      // Allow cross-platform coordinate rounding at nine decimal places (mm).
      // Route types, layers, widths, diameters, and metadata still match exactly.
      const point = trace.route[index]
      const expectedPoint =
        "x" in point && "y" in point
          ? {
              ...point,
              x: expect.closeTo(point.x, 9),
              y: expect.closeTo(point.y, 9),
            }
          : point
      expect(captured.route[index]).toMatchObject(expectedPoint)
    }
  }

  console.table({ beforeRepair, afterRepair, finalOutput: finalVia })
})
