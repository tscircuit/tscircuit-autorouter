import { expect, test } from "bun:test"
import { getTerminalLayerIndicesByPcbPortId } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getTerminalLayerIndicesByPcbPortId"
import type { Obstacle, SimpleRouteConnection } from "lib/types"

test("coincident single-layer pads do not impersonate a multilayer PCB terminal", () => {
  const connections: SimpleRouteConnection[] = [
    {
      name: "net0",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pcb_port_id: "pcb_port_top" },
        { x: 0, y: 0, layer: "bottom", pcb_port_id: "pcb_port_bottom" },
      ],
    },
  ]
  const connectedToWholeNet = ["net0", "pcb_port_top", "pcb_port_bottom"]
  const obstacles: Obstacle[] = [
    {
      type: "rect",
      layers: ["top"],
      center: { x: 0, y: 0 },
      width: 0.5,
      height: 0.5,
      connectedTo: connectedToWholeNet,
    },
    {
      type: "rect",
      layers: ["bottom"],
      center: { x: 0, y: 0 },
      width: 0.5,
      height: 0.5,
      connectedTo: connectedToWholeNet,
    },
  ]

  const terminalLayerIndicesByPcbPortId = getTerminalLayerIndicesByPcbPortId(
    connections,
    obstacles,
    2,
  )

  expect([...terminalLayerIndicesByPcbPortId.get("pcb_port_top")!]).toEqual([0])
  expect([...terminalLayerIndicesByPcbPortId.get("pcb_port_bottom")!]).toEqual([
    1,
  ])
})
