import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

const srj: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  minViaDiameter: 0.3,
  obstacles: [],
  connections: [
    {
      name: "conn1",
      pointsToConnect: [
        { x: -0.5, y: 0, layer: "top" },
        { x: 0.5, y: 0, layer: "top" },
      ],
    },
  ],
  bounds: {
    minX: -5,
    maxX: 5,
    minY: -5,
    maxY: 5,
  },
}

const nodeWithPortPoints: NodeWithPortPoints = {
  capacityMeshNodeId: "cmn_1",
  center: { x: 0, y: 0 },
  width: 2,
  height: 2,
  portPoints: [
    {
      connectionName: "conn1",
      x: -0.5,
      y: 0,
      z: 0,
    },
    {
      connectionName: "conn1",
      x: 0.5,
      y: 0,
      z: 0,
    },
  ],
}

const simpleViaSrj: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  minViaDiameter: 0.3,
  min_via_pad_diameter: 1.5,
  min_via_hole_diameter: 0.4,
  bounds: {
    minX: -6,
    maxX: 6,
    minY: -2,
    maxY: 2,
  },
  obstacles: [
    {
      type: "rect",
      layers: ["top"],
      center: { x: 0, y: 0 },
      width: 6.5,
      height: 3.6,
      connectedTo: ["blocker"],
    },
  ],
  connections: [
    {
      name: "net1",
      pointsToConnect: [
        { x: -5.5, y: 0, layer: "top" },
        { x: 5.5, y: 0, layer: "top" },
      ],
    },
  ],
}

test("pipeline4 uses min_via_pad_diameter as the routing via diameter", () => {
  const solver = new AutoroutingPipelineSolver4({
    ...srj,
    minViaDiameter: 0.3,
    min_via_hole_diameter: 0.2,
    min_via_pad_diameter: 0.52,
  })

  expect(solver.viaDiameter).toBe(0.52)
  expect(solver.viaHoleDiameter).toBe(0.2)

  const escapeStep = solver.pipelineDef.find(
    (step) => step.solverName === "escapeViaLocationSolver",
  )
  const [, escapeOpts] = escapeStep!.getConstructorParams(solver) as any
  expect(escapeOpts.viaDiameter).toBe(0.52)

  solver.srjWithPointPairs = srj
  solver.portPointPathingSolver = {
    getOutput: () => ({
      nodesWithPortPoints: [nodeWithPortPoints],
      inputNodeWithPortPoints: [],
    }),
  } as any

  const highDensityStep = solver.pipelineDef.find(
    (step) => step.solverName === "highDensityRouteSolver",
  )
  const [highDensityParams] = highDensityStep!.getConstructorParams(
    solver,
  ) as any
  expect(highDensityParams.viaDiameter).toBe(0.52)
})

test(
  "pipeline4 emits requested via pad and hole diameters on a simple forced-via circuit",
  () => {
    const solver = new AutoroutingPipelineSolver4(structuredClone(simpleViaSrj))
    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)

    const output = solver.getOutputSimpleRouteJson()
    const viaSegments = (output.traces ?? []).flatMap((trace) =>
      trace.route.filter((segment) => segment.route_type === "via"),
    )

    expect(viaSegments.length).toBeGreaterThan(0)
    expect(
      viaSegments.every(
        (segment) =>
          segment.via_diameter === 1.5 && segment.via_hole_diameter === 0.4,
      ),
    ).toBe(true)

    expect(convertSrjToGraphicsObject(output)).toMatchGraphicsSvg(
      import.meta.path,
    )

    const circuitJson = convertToCircuitJson(output, output.traces ?? [])
    const vias = circuitJson.filter((element) => element.type === "pcb_via")

    expect(vias.length).toBeGreaterThan(0)
    expect(
      vias.every(
        (via: any) => via.outer_diameter === 1.5 && via.hole_diameter === 0.4,
      ),
    ).toBe(true)
  },
  { timeout: 120_000 },
)
