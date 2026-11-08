import { expect, test } from "bun:test"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { stitchPipeline9RepairedFragments } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/stitchPipeline9RepairedFragments"

test("repaired fragment stitching uses existing copper and preserves terminal and width identity", (): void => {
  const connections: SimpleRouteConnection[] = [
    {
      name: "net",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pcb_port_id: "a" },
        { x: 2, y: 0, layer: "bottom", pcb_port_id: "b" },
      ],
    },
  ]
  const routes: HighDensityRoute[] = [
    {
      connectionName: "net",
      traceThickness: 0.1,
      viaDiameter: 0.45,
      startPcbPortId: "a",
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 0, z: 2 },
        { x: 1, y: 1, z: 2 },
      ],
      vias: [{ x: 1, y: 0 }],
    },
    {
      connectionName: "net",
      traceThickness: 0.2,
      viaDiameter: 0.45,
      startPcbPortId: "b",
      route: [
        { x: 2, y: 0, z: 3, traceThickness: 0.3 },
        { x: 1, y: 0, z: 3 },
        { x: 1, y: 0, z: 2 },
        { x: 1, y: -1, z: 2 },
      ],
      vias: [{ x: 1, y: 0 }],
    },
  ]
  const original = structuredClone(routes)
  const stitch = (input: HighDensityRoute[]): HighDensityRoute[] =>
    stitchPipeline9RepairedFragments({
      routes: input,
      connections,
      isValid: () => true,
    })
  const output = stitch(routes)
  expect(output).toHaveLength(1)
  expect(output[0]!.route).toEqual([
    expect.objectContaining({
      x: 0,
      y: 0,
      z: 0,
      traceThickness: 0.1,
      pcb_port_id: "a",
    }),
    expect.objectContaining({ x: 1, y: 0, z: 0, traceThickness: 0.1 }),
    expect.objectContaining({ x: 1, y: 0, z: 3, traceThickness: 0.3 }),
    expect.objectContaining({ x: 2, y: 0, z: 3, pcb_port_id: "b" }),
  ])
  expect(output[0]!.vias).toEqual([{ x: 1, y: 0 }])
  expect(output[0]!.startPcbPortId).toBe("a")
  expect(output[0]!.endPcbPortId).toBe("b")
  expect(routes).toEqual(original)
  expect(
    stitchPipeline9RepairedFragments({
      routes,
      connections,
      isValid: () => false,
    }),
  ).toBe(routes)
  const thirdTerminal = structuredClone(routes)
  thirdTerminal[0]!.endPcbPortId = "c"
  expect(stitch(thirdTerminal)).toBe(thirdTerminal)
  const disconnected = structuredClone(routes)
  for (const point of disconnected[1]!.route) point.y += 0.5
  expect(stitch(disconnected)).toBe(disconnected)
  const jumper = structuredClone(routes)
  jumper[0]!.route[0]!.toNextSegmentType = "through_obstacle"
  expect(stitch(jumper)).toBe(jumper)
  let checked = false
  expect(
    stitchPipeline9RepairedFragments({
      routes: output,
      connections,
      isValid: () => {
        checked = true
        return true
      },
    }),
  ).toBe(output)
  expect(checked).toBeFalse()
})
