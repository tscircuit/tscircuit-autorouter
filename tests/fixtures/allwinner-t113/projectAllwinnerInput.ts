import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { Obstacle, SimpleRouteJson } from "../../../lib/types/srj-types"

type SourceObstacle = Omit<Obstacle, "type"> & {
  type: "rect" | "oval"
  shape?: "circle"
}
type SourceInput = Omit<SimpleRouteJson, "obstacles"> & {
  obstacles: SourceObstacle[]
}

/**
 * Projects the saved Allwinner placement into a common two-layer routing task.
 * Coordinates are millimeters in the board XY frame: +X right, +Y up.
 * All shapes become axis-aligned rectangles; through pads connect both layers.
 * Single-terminal plane jobs are omitted and their pads remain keepouts.
 */
export function projectAllwinnerInput(source: SourceInput): SimpleRouteJson {
  const signalConnections = source.connections.filter(
    (connection) => connection.pointsToConnect.length > 1,
  )
  const connectionNames = new Set(signalConnections.map(({ name }) => name))
  const obstacles = source.obstacles.map((obstacle, index): Obstacle => {
    const rotation = ((obstacle.ccwRotationDegrees ?? 0) + 360) % 360
    if (![0, 90, 180, 270].includes(rotation)) {
      throw new Error(
        `Cannot exactly bound obstacle ${index} at ${rotation}deg`,
      )
    }
    const connectedTo = obstacle.connectedTo.filter((name) =>
      connectionNames.has(name),
    )
    if (connectedTo.length > 1) {
      throw new Error(`Obstacle ${index} belongs to multiple signal nets`)
    }
    const swapDimensions = rotation === 90 || rotation === 270
    return {
      obstacleId: `allwinner_obstacle_${index}`,
      componentId: obstacle.componentId,
      circuitJsonMetadata: obstacle.circuitJsonMetadata,
      type: "rect",
      layers: obstacle.layers.filter((layer) =>
        ["top", "bottom"].includes(layer),
      ),
      center: { ...obstacle.center },
      width: swapDimensions ? obstacle.height : obstacle.width,
      height: swapDimensions ? obstacle.width : obstacle.height,
      connectedTo,
    }
  })
  const terminalObstacles = new Set<Obstacle>()
  const connections = signalConnections.map((connection) => ({
    name: connection.name,
    nominalTraceWidth: 0.15,
    pointsToConnect: connection.pointsToConnect.map((point) => {
      const matches = obstacles.filter(
        (obstacle) =>
          obstacle.circuitJsonMetadata?.pcb_port_id === point.pcb_port_id,
      )
      if (matches.length !== 1 || !point.pcb_port_id) {
        throw new Error(`Expected one physical pad for ${point.pcb_port_id}`)
      }
      const obstacle = matches[0]!
      if (
        obstacle.connectedTo[0] !== connection.name ||
        Math.abs(point.x - obstacle.center.x) > obstacle.width / 2 ||
        Math.abs(point.y - obstacle.center.y) > obstacle.height / 2
      ) {
        throw new Error(
          `Terminal/net geometry mismatch at ${point.pcb_port_id}`,
        )
      }
      terminalObstacles.add(obstacle)
      const common = {
        x: point.x,
        y: point.y,
        pointId: point.pointId,
        pcb_port_id: point.pcb_port_id,
      }
      return obstacle.layers.length === 1
        ? { ...common, layer: obstacle.layers[0]! }
        : { ...common, layers: [...obstacle.layers] }
    }),
  }))
  for (const obstacle of obstacles) {
    if (obstacle.connectedTo.length > 0 && !terminalObstacles.has(obstacle)) {
      throw new Error(
        `Signal pad has no requested terminal: ${obstacle.obstacleId}`,
      )
    }
  }
  return {
    layerCount: 2,
    bounds: { ...source.bounds },
    minTraceWidth: 0.15,
    nominalTraceWidth: 0.15,
    defaultObstacleMargin: 0.15,
    minTraceToPadEdgeClearance: 0.15,
    minBoardEdgeClearance: 0.15,
    minViaEdgeToPadEdgeClearance: 0.15,
    minViaPadDiameter: 0.6,
    minViaHoleDiameter: 0.3,
    allowViaInPad: false,
    obstacles,
    connections,
    traces: [],
  }
}

if (import.meta.main) {
  const source = gunzipSync(
    new Uint8Array(
      readFileSync(new URL("./frozen-source.srj.json.gz", import.meta.url)),
    ),
  )
  const sourceHash = createHash("sha256")
    .update(new Uint8Array(source))
    .digest("hex")
  if (
    sourceHash !==
    "447174f009434e9c5bb026bf53ed8a053fccd8b307328c5a092bba1c3f481bdb"
  ) {
    throw new Error("Frozen Allwinner source SHA-256 does not match")
  }
  const projected = projectAllwinnerInput(JSON.parse(source.toString()))
  const output = `${JSON.stringify(projected, null, 2)}\n`
  writeFileSync(new URL("./fixed-input.srj.json", import.meta.url), output)
  console.log(createHash("sha256").update(output).digest("hex"))
}
