import type { SimpleRouteJson, ConnectionPoint } from "lib/types"

/** Board-world mm, +X right, +Y up. Each lane turns back out of its ESD pad. */
export function getBentDifferentialPairSrj(withTap = false): SimpleRouteJson {
  const pads = [
    { name: "J1", x: -3, y: 0 },
    { name: "ESD", x: 0, y: 5 },
    { name: "MCU", x: 3, y: 0 },
  ].flatMap((component) =>
    ["P", "N"].map((lane) => ({
      id: `${component.name}.${lane}`,
      x: component.x,
      y: component.y + (lane === "P" ? 0.5 : -0.5),
      lane,
    })),
  )
  if (withTap) pads.push({ id: "TP.P", x: 6, y: 5, lane: "P" })
  const terminal = (id: string): ConnectionPoint => {
    const pad = pads.find((pad) => pad.id === id)!
    return { x: pad.x, y: pad.y, layer: "top", pointId: id, pcb_port_id: id }
  }
  return {
    bounds: { minX: -12, maxX: 12, minY: -9, maxY: 15 },
    layerCount: 2,
    minTraceWidth: 0.15,
    obstacles: pads.map((pad) => ({
      type: "rect",
      center: { x: pad.x, y: pad.y },
      width: 0.6,
      height: 0.6,
      layers: ["top"],
      // Include electrical aliases, as a real SRJ producer does.
      connectedTo: [pad.id, pad.lane, `${pad.lane}1`, `${pad.lane}2`],
    })),
    connections: ["P", "N"]
      .flatMap((lane) => [
        {
          name: `${lane}1`,
          netConnectionName: lane,
          pointsToConnect: [terminal(`J1.${lane}`), terminal(`ESD.${lane}`)],
        },
        {
          name: `${lane}2`,
          netConnectionName: lane,
          pointsToConnect: [terminal(`ESD.${lane}`), terminal(`MCU.${lane}`)],
        },
      ])
      .concat(
        withTap
          ? [
              {
                name: "tap",
                netConnectionName: "P",
                pointsToConnect: [terminal("ESD.P"), terminal("TP.P")],
              },
            ]
          : [],
      ),
    differentialPairs: [
      {
        connectionNames: [
          ["P1", "P2"],
          ["N1", "N2"],
        ],
        maxLengthSkewMm: 0.1,
      },
    ],
  }
}
