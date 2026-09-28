import type { CorpusSample } from "./types"

type Segment = { x1: number; y1: number; x2: number; y2: number; width: number; layer: string }

/** Validate constructive straight controls, including pad clearance and pair constraints. */
export function validateControlWitness(sample: CorpusSample): string[] {
  const errors: string[] = []
  const witness = sample.controlWitness
  if (sample.kind !== "control") return errors
  if (!witness || witness.length !== sample.srj.connections.length) {
    return [`${sample.sampleId}: control requires one witness trace per copper net`]
  }
  const segments = new Map<string, Segment>()
  const clearance = sample.srj.minTraceToPadEdgeClearance ?? 0
  for (const trace of witness) {
    const connection = sample.srj.connections.find((candidate) => candidate.name === trace.connection_name)
    const [start, end] = trace.route
    if (!connection || trace.route.length !== 2 || !start || !end ||
      start.route_type !== "wire" || end.route_type !== "wire" || start.layer !== end.layer ||
      Math.min(Math.abs(start.x - end.x), Math.abs(start.y - end.y)) > 1e-8) {
      errors.push(`${sample.sampleId}: unsupported control witness route`)
      continue
    }
    if (!Number.isFinite(start.width) || start.width < sample.srj.minTraceWidth - 1e-8 ||
      Math.abs(start.width - end.width) > 1e-8) errors.push(`${sample.sampleId}: invalid witness width`)
    const boardMargin = start.width / 2 + (sample.srj.minBoardEdgeClearance ?? 0)
    if (Math.min(start.x, end.x) < sample.srj.bounds.minX + boardMargin - 1e-8 ||
      Math.max(start.x, end.x) > sample.srj.bounds.maxX - boardMargin + 1e-8 ||
      Math.min(start.y, end.y) < sample.srj.bounds.minY + boardMargin - 1e-8 ||
      Math.max(start.y, end.y) > sample.srj.bounds.maxY - boardMargin + 1e-8) errors.push(`${sample.sampleId}: witness violates board clearance`)
    if (segments.has(trace.connection_name)) errors.push(`${sample.sampleId}: repeated witness copper net`)
    segments.set(trace.connection_name, {
      x1: start.x, y1: start.y, x2: end.x, y2: end.y, width: start.width, layer: start.layer,
    })
    for (const [index, terminal] of connection.pointsToConnect.entries()) {
      const endpoint = index === 0 ? start : end
      if (Math.hypot(terminal.x - endpoint.x, terminal.y - endpoint.y) > 1e-8 ||
        terminal.layer !== endpoint.layer) errors.push(`${sample.sampleId}: witness misses terminal`)
    }
    for (const obstacle of sample.srj.obstacles) {
      if (!obstacle.layers.includes(start.layer) || obstacle.connectedTo.includes(connection.name)) continue
      const separationX = Math.max(obstacle.center.x - obstacle.width / 2 - Math.max(start.x, end.x),
        Math.min(start.x, end.x) - obstacle.center.x - obstacle.width / 2, 0)
      const separationY = Math.max(obstacle.center.y - obstacle.height / 2 - Math.max(start.y, end.y),
        Math.min(start.y, end.y) - obstacle.center.y - obstacle.height / 2, 0)
      if (Math.hypot(separationX, separationY) + 1e-8 < start.width / 2 + clearance) {
        errors.push(`${sample.sampleId}: witness violates pad clearance at ${obstacle.obstacleId}`)
      }
    }
  }
  for (const pair of sample.srj.differentialPairs ?? []) {
    const positive = segments.get(pair.connectionNames[0]), negative = segments.get(pair.connectionNames[1])
    if (!positive || !negative) continue
    const positiveLength = Math.hypot(positive.x2 - positive.x1, positive.y2 - positive.y1)
    const negativeLength = Math.hypot(negative.x2 - negative.x1, negative.y2 - negative.y1)
    const spacing = Math.hypot(positive.x1 - negative.x1, positive.y1 - negative.y1)
    const endSpacing = Math.hypot(positive.x2 - negative.x2, positive.y2 - negative.y2)
    const gap = spacing - (positive.width + negative.width) / 2
    if (Math.abs(positiveLength - negativeLength) > pair.lengthTolerance + 1e-8 ||
      Math.abs(spacing - endSpacing) > 1e-8 || positive.layer !== negative.layer ||
      pair.traceGap === undefined || Math.abs(gap - pair.traceGap) > 1e-8) {
      errors.push(`${sample.sampleId}: witness violates pair gap or skew`)
    }
  }
  const traceSegments = [...segments.values()]
  for (let firstIndex = 0; firstIndex < traceSegments.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < traceSegments.length; secondIndex++) {
      const first = traceSegments[firstIndex]!, second = traceSegments[secondIndex]!
      if (first.layer !== second.layer) continue
      const separationX = Math.max(Math.min(first.x1, first.x2) - Math.max(second.x1, second.x2),
        Math.min(second.x1, second.x2) - Math.max(first.x1, first.x2), 0)
      const separationY = Math.max(Math.min(first.y1, first.y2) - Math.max(second.y1, second.y2),
        Math.min(second.y1, second.y2) - Math.max(first.y1, first.y2), 0)
      if (Math.hypot(separationX, separationY) + 1e-8 < (first.width + second.width) / 2 + (sample.srj.defaultObstacleMargin ?? 0)) {
        errors.push(`${sample.sampleId}: witness shorts copper traces`)
      }
    }
  }
  return errors
}
