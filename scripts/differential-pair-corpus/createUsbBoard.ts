import type { Obstacle, SimpleRouteJson, SimplifiedPcbTraces } from "../../lib/types"
import type { CorpusKind, CorpusLogicalPath } from "./types"

type UsbBoardOptions = {
  pairCount: number
  kind: CorpusKind
  random: () => number
  layerCount: 2 | 4
}
type UsbBoardOutput = {
  srj: SimpleRouteJson
  logicalPaths: CorpusLogicalPath[]
  controlWitness?: SimplifiedPcbTraces
}

/** USB2-only USB-C abstraction: D+/D- contacts plus neighboring copper pads. */
export function createUsbBoard(options: UsbBoardOptions): UsbBoardOutput {
  const { random, pairCount, kind, layerCount } = options
  const height = pairCount * 12
  const controllerX = 25 + random() * 3
  const resistorX = 13 + random() * 5
  const traceWidth = 0.12 + Math.floor(random() * 3) * 0.02
  const traceGap = kind === "control" ? 0.5 - traceWidth : 0.13 + Math.floor(random() * 3) * 0.025
  const srj: SimpleRouteJson = {
    layerCount,
    minTraceWidth: traceWidth,
    minViaDiameter: 0.5,
    minViaHoleDiameter: 0.25,
    minTraceToPadEdgeClearance: 0.1,
    minBoardEdgeClearance: 0.2,
    defaultObstacleMargin: 0.1,
    bounds: { minX: 0, maxX: 32, minY: 0, maxY: height },
    connections: [],
    differentialPairs: [],
    obstacles: [],
  }
  const logicalPaths: CorpusLogicalPath[] = []
  for (let pairIndex = 0; pairIndex < pairCount; pairIndex++) {
    const centerY = 6 + pairIndex * 12
    const sinkCenterY = kind === "stress" ? 6 + (pairCount - pairIndex - 1) * 12 : centerY
    const sinkOffsetY = kind === "control" ? 0 : (random() - 0.5) * 3
    const sinkLayer = kind === "stress" && random() > 0.6 ? "bottom" : "top"
    const path: CorpusLogicalPath = {
      pairId: `usb_${pairIndex}`,
      positiveConnectionNames: [],
      negativeConnectionNames: [],
      seriesComponents: [],
    }
    for (const polarity of ["p", "n"] as const) {
      const sign = polarity === "p" ? -1 : 1
      const beforeName = `usb_${pairIndex}_${polarity}_connector_to_resistor`
      const afterName = `usb_${pairIndex}_${polarity}_resistor_to_controller`
      const terminals = [
        { x: 3, y: centerY + sign * 0.25, layer: "top", net: beforeName, id: `J${pairIndex}_${polarity}` },
        { x: resistorX - 0.5, y: centerY + sign * (kind === "control" ? 0.25 : 0.6), layer: "top", net: beforeName, id: `R${pairIndex}_${polarity}_1` },
        { x: resistorX + 0.5, y: centerY + sign * (kind === "control" ? 0.25 : 0.6), layer: "top", net: afterName, id: `R${pairIndex}_${polarity}_2` },
        { x: controllerX, y: sinkCenterY + sinkOffsetY + sign * (kind === "control" ? 0.25 : 0.4), layer: sinkLayer, net: afterName, id: `U${pairIndex}_${polarity}` },
      ]
      for (const terminal of terminals) {
        srj.obstacles.push({
          obstacleId: terminal.id,
          componentId: terminal.id.startsWith("R") ? `R${pairIndex}_${polarity}` : terminal.id.split("_")[0],
          type: "rect",
          center: { x: terminal.x, y: terminal.y },
          width: terminal.id.startsWith("J") ? 0.7 : 0.5,
          height: terminal.id.startsWith("J") ? 0.25 : 0.4,
          layers: [terminal.layer],
          connectedTo: [terminal.net, terminal.id],
        })
      }
      for (const [connectionName, offset] of [[beforeName, 0], [afterName, 2]] as const) {
        srj.connections.push({
          name: connectionName,
          pointsToConnect: terminals.slice(offset, offset + 2).map((terminal) => ({
            x: terminal.x, y: terminal.y, layer: terminal.layer,
            pcb_port_id: terminal.id,
          })),
        })
      }
      const members = polarity === "p" ? path.positiveConnectionNames : path.negativeConnectionNames
      members.push(beforeName, afterName)
      path.seriesComponents.push({
        componentId: `R${pairIndex}_${polarity}`,
        polarity: polarity === "p" ? "positive" : "negative",
        upstreamConnectionName: beforeName,
        downstreamConnectionName: afterName,
        inputPortId: terminals[1]!.id,
        outputPortId: terminals[2]!.id,
      })
    }
    // No copper connection crosses either resistor; paths describe electrical series order only.
    for (let segmentIndex = 0; segmentIndex < 2; segmentIndex++) {
      srj.differentialPairs!.push({
        connectionNames: [path.positiveConnectionNames[segmentIndex]!, path.negativeConnectionNames[segmentIndex]!],
        lengthTolerance: 0.1,
        traceGap,
        maxUncoupledLength: 4,
      })
    }
    logicalPaths.push(path)
    // Neighboring USB-C contacts and controller pads add real copper congestion.
    for (const offset of [-2.75, -2.25, -1.75, -1.25, -0.75, 0.75, 1.25, 1.75, 2.25, 2.75]) {
      srj.obstacles.push({
        obstacleId: `J${pairIndex}_neighbor_${offset}`,
        componentId: `J${pairIndex}`,
        type: "rect", center: { x: 3, y: centerY + offset },
        width: 0.7, height: 0.25, layers: ["top"],
        connectedTo: [`J${pairIndex}_neighbor_${offset}`],
      })
    }
  }
  if (kind === "infeasible") {
    srj.obstacles.push({
      obstacleId: "deliberate_all_layer_barrier", type: "rect",
      center: { x: 8, y: height / 2 }, width: 0.5, height,
      layers: layerCount === 4 ? ["top", "inner1", "inner2", "bottom"] : ["top", "bottom"],
      connectedTo: [],
    })
  }
  if (kind === "stress") {
    const targetCount = 6 + pairCount * 3
    let added = 0
    for (let attempt = 0; attempt < 200 && added < targetCount; attempt++) {
      const obstacle: Obstacle = {
        obstacleId: `congestion_${added}`, type: "rect",
        center: { x: 6 + random() * 17, y: 1 + random() * (height - 2) },
        width: 0.5 + random() * 1.5, height: 0.5 + random() * 1.2,
        layers: random() > 0.3 ? ["top"] : ["top", "bottom"], connectedTo: [],
      }
      if (srj.obstacles.some((existing) =>
        Math.abs(existing.center.x - obstacle.center.x) < (existing.width + obstacle.width) / 2 + 0.3 &&
        Math.abs(existing.center.y - obstacle.center.y) < (existing.height + obstacle.height) / 2 + 0.3,
      )) continue
      srj.obstacles.push(obstacle)
      added++
    }
    if (added !== targetCount) throw new Error("Could not place requested non-overlapping congestion")
  }
  const controlWitness: SimplifiedPcbTraces | undefined = kind === "control"
    ? srj.connections.map((connection) => ({
      type: "pcb_trace",
      pcb_trace_id: `witness_${connection.name}`,
      connection_name: connection.name,
      route: connection.pointsToConnect.map((point) => ({
        route_type: "wire", x: point.x, y: point.y,
        layer: "top", width: srj.minTraceWidth,
      })),
    })) : undefined
  return { srj, logicalPaths, controlWitness }
}
