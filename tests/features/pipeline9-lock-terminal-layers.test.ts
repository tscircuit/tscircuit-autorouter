import { expect, test } from "bun:test"
import { lockPipeline9TerminalLayers } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/lock-pipeline9-terminal-layers"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 restores terminal layers after simplification", () => {
  const route: HighDensityRoute = {
    connectionName: "conn",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: 0, y: 0, z: 1, pcb_port_id: "start" },
      { x: 1, y: 0, z: 1 },
      { x: 2, y: 0, z: 1, pcb_port_id: "end" },
    ],
  }

  const [locked] = lockPipeline9TerminalLayers(
    [route],
    [
      {
        name: "conn",
        pointsToConnect: [
          {
            x: 0,
            y: 0,
            layer: "top",
            pointId: "start",
            pcb_port_id: "start",
          },
          {
            x: 2,
            y: 0,
            layer: "top",
            pointId: "end",
            pcb_port_id: "end",
          },
        ],
      },
    ],
    2,
  )

  expect(locked?.route).toEqual([
    { x: 0, y: 0, z: 0, pcb_port_id: "start" },
    { x: 0, y: 0, z: 1 },
    { x: 1, y: 0, z: 1 },
    { x: 2, y: 0, z: 1 },
    { x: 2, y: 0, z: 0, pcb_port_id: "end" },
  ])
  expect(locked?.vias).toEqual([
    { x: 0, y: 0 },
    { x: 2, y: 0 },
  ])
})
