import type { CorpusSample } from "./types"

/** Structural checks for generated input, distinct from routing feasibility. */
export function validateSampleTopology(sample: CorpusSample): string[] {
  const { srj } = sample
  const errors: string[] = []
  const allowedLayers = new Set(
    srj.layerCount === 2
      ? ["top", "bottom"]
      : srj.layerCount === 4
        ? ["top", "inner1", "inner2", "bottom"]
        : ["top"],
  )
  const connections = new Map(
    srj.connections.map((connection) => [connection.name, connection]),
  )
  if (
    ![
      srj.bounds.minX,
      srj.bounds.minY,
      srj.bounds.maxX,
      srj.bounds.maxY,
      srj.minTraceWidth,
    ].every(Number.isFinite) ||
    srj.minTraceWidth <= 0 ||
    ![1, 2, 4].includes(srj.layerCount)
  )
    errors.push(`${sample.sampleId}: invalid board geometry`)
  for (const connection of srj.connections) {
    if (connection.pointsToConnect.length < 2)
      errors.push(`${sample.sampleId}: connection has fewer than two terminals`)
    for (const point of connection.pointsToConnect) {
      const layers = point.layers === undefined ? [point.layer] : point.layers
      if (
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        point.x < srj.bounds.minX - 1e-8 ||
        point.x > srj.bounds.maxX + 1e-8 ||
        point.y < srj.bounds.minY - 1e-8 ||
        point.y > srj.bounds.maxY + 1e-8 ||
        !layers.length ||
        layers.some((layer) => !allowedLayers.has(layer))
      ) {
        errors.push(
          `${sample.sampleId}: invalid terminal geometry/layer for ${connection.name}`,
        )
      }
    }
  }
  for (const obstacle of srj.obstacles) {
    if (
      ![
        obstacle.center.x,
        obstacle.center.y,
        obstacle.width,
        obstacle.height,
      ].every(Number.isFinite) ||
      obstacle.width <= 0 ||
      obstacle.height <= 0 ||
      !obstacle.layers.length ||
      obstacle.layers.some((layer) => !allowedLayers.has(layer))
    )
      errors.push(`${sample.sampleId}: invalid obstacle geometry/layer`)
  }
  for (const pair of srj.differentialPairs ?? []) {
    for (const obstacle of srj.obstacles) {
      if (
        pair.connectionNames.every((name) =>
          obstacle.connectedTo.includes(name),
        )
      ) {
        errors.push(
          `${sample.sampleId}: obstacle electrically shorts pair polarities`,
        )
      }
    }
  }
  for (const path of sample.logicalPaths) {
    if (
      path.positiveConnectionNames.length !==
        path.negativeConnectionNames.length ||
      path.seriesComponents.length !==
        2 * (path.positiveConnectionNames.length - 1)
    ) {
      errors.push(`${sample.sampleId}: malformed series chain ${path.pairId}`)
    }
    for (const [
      index,
      positiveName,
    ] of path.positiveConnectionNames.entries()) {
      if (
        !srj.differentialPairs?.some(
          (pair) =>
            pair.connectionNames[0] === positiveName &&
            pair.connectionNames[1] === path.negativeConnectionNames[index],
        )
      ) {
        errors.push(
          `${sample.sampleId}: logical segment lacks explicit pair correspondence`,
        )
      }
    }
    const componentIds = new Set<string>()
    const seriesEdges = new Set<string>()
    for (const component of path.seriesComponents) {
      const chain =
        component.polarity === "positive"
          ? path.positiveConnectionNames
          : path.negativeConnectionNames
      const upstreamIndex = chain.indexOf(component.upstreamConnectionName)
      if (
        upstreamIndex < 0 ||
        chain[upstreamIndex + 1] !== component.downstreamConnectionName ||
        component.inputPortId === component.outputPortId ||
        componentIds.has(component.componentId)
      ) {
        errors.push(
          `${sample.sampleId}: resistor does not join adjacent distinct copper nets`,
        )
      }
      componentIds.add(component.componentId)
      const seriesEdge = `${component.upstreamConnectionName}:${component.downstreamConnectionName}`
      if (seriesEdges.has(seriesEdge))
        errors.push(`${sample.sampleId}: duplicate series correspondence`)
      seriesEdges.add(seriesEdge)
      for (const [connectionName, portId] of [
        [component.upstreamConnectionName, component.inputPortId],
        [component.downstreamConnectionName, component.outputPortId],
      ]) {
        const connection = connections.get(connectionName!)
        const point = connection?.pointsToConnect.find(
          (terminal) => terminal.pcb_port_id === portId,
        )
        const pad = srj.obstacles.find(
          (obstacle) => obstacle.obstacleId === portId,
        )
        if (
          !point ||
          !pad ||
          pad.componentId !== component.componentId ||
          !pad.connectedTo.includes(connectionName!) ||
          Math.abs(point.x - pad.center.x) > pad.width / 2 + 1e-8 ||
          Math.abs(point.y - pad.center.y) > pad.height / 2 + 1e-8 ||
          point.layer === undefined ||
          !pad.layers.includes(point.layer)
        ) {
          errors.push(
            `${sample.sampleId}: resistor terminal has invalid pad ownership`,
          )
        }
      }
    }
  }
  if (sample.kind === "infeasible") {
    const barrier = srj.obstacles.find(
      (obstacle) => obstacle.obstacleId === "deliberate_all_layer_barrier",
    )
    const spansWidth =
      barrier !== undefined &&
      barrier.center.x - barrier.width / 2 <= srj.bounds.minX + 1e-8 &&
      barrier.center.x + barrier.width / 2 >= srj.bounds.maxX - 1e-8
    const spansHeight =
      barrier !== undefined &&
      barrier.center.y - barrier.height / 2 <= srj.bounds.minY + 1e-8 &&
      barrier.center.y + barrier.height / 2 >= srj.bounds.maxY - 1e-8
    const separatesTerminals =
      barrier !== undefined &&
      srj.connections.some((connection) => {
        const coordinates = connection.pointsToConnect.map((point) =>
          spansHeight ? point.x : point.y,
        )
        const center = spansHeight ? barrier.center.x : barrier.center.y
        const size = spansHeight ? barrier.width : barrier.height
        return (
          Math.min(...coordinates) < center - size / 2 &&
          Math.max(...coordinates) > center + size / 2
        )
      })
    if (
      !barrier ||
      barrier.connectedTo.length ||
      ![...allowedLayers].every((layer) => barrier.layers.includes(layer)) ||
      !(spansWidth || spansHeight) ||
      !separatesTerminals
    )
      errors.push(
        `${sample.sampleId}: infeasible classification lacks full-layer separating barrier`,
      )
  }
  return errors
}
