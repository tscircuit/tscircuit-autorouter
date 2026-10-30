import { checkViasInPads } from "@tscircuit/checks"
import { getFixedObstacleViolations, getNewViaPadViolations } from "@tscircuit/repair04"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getViaToPadClearance } from "lib/utils/getViaToPadClearance"
import { Pipeline9IntentOwners, type OriginalIntentJson } from "./checkPipeline9OriginalIntentCopper"
import { checkBoardEnvelope, type WitnessViaCertificate } from "./getPipeline9WitnessViaCertificate"

type Input = { original: SimpleRouteJson; pointPairs: SimpleRouteJson; traces: SimplifiedPcbTrace[]; certificate: WitnessViaCertificate }
export type RelativeGeometryDetails = {
  nativeErrors: OriginalIntentJson[]; nativeErrorsWithCenters: OriginalIntentJson[]; nativeLocationAwareErrors: OriginalIntentJson[]
  viaInPad: OriginalIntentJson[]; srjObstacles: OriginalIntentJson[]; viaPadPolicy: OriginalIntentJson[]; boardReasons: string[]
}

/** Observes the exact existing predicates; it does not replace the full certificate.
 * Route construction and predicate options mirror its frozen source body. Every
 * result is checked against that independently computed full return before use.
 */
export function getPipeline9RelativeGeometryDetails({ original, pointPairs, traces, certificate }: Input): RelativeGeometryDetails {
  const native = evaluateRelaxedDrc({ inputSrj: original, srjWithPointPairs: pointPairs, routedTraces: traces, includeBoardClearance: true,
    drcOptions: { traceClearance: original.minTraceToPadEdgeClearance ?? 0.1, viaClearance: original.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1 } })
  if (JSON.stringify(native.circuitJson) !== JSON.stringify(certificate.circuitJson)) throw new Error("Detailed geometry canonical output differs from the full certificate")
  const viaInPad = original.allowViaInPad === true ? [] : checkViasInPads(native.circuitJson)
  const owners = new Pipeline9IntentOwners(original, pointPairs)
  const obstacles = original.obstacles.map((obstacle) => {
    const owner = owners.obstacle(obstacle)
    return { ...obstacle, connectedTo: owner.status === "RESOLVED" ? [owner.owner] : [] }
  })
  const sites = certificate.sites
  const stack = original.layerCount === 1 ? ["top"] : ["top", ...Array.from({ length: original.layerCount - 2 }, (_, i) => `inner${i + 1}`), "bottom"]
  const routes: HighDensityRoute[] = [], bindings: OriginalIntentJson[] = []
  for (const [traceIndex, trace] of traces.entries()) {
    const owner = owners.traceReference(trace.connection_name)
    if (owner.status !== "RESOLVED") throw new Error("Detailed obstacle check lost original ownership")
    for (let index = 0; index < trace.route.length; index++) {
      const point = trace.route[index]!, next = trace.route[index + 1]
      if (point.route_type === "via") {
        const site = sites.find((site) => site.x === point.x && site.y === point.y)
        if (!site) throw new Error("Detailed obstacle check lost raw via")
        const manufacturedIndices = site.layers.map((layer) => stack.indexOf(layer))
        routes.push({ connectionName: owner.owner, rootConnectionName: owner.owner, traceThickness: original.minTraceWidth, viaDiameter: site.diameter, vias: [{ x: site.x, y: site.y }], route: [{ x: site.x, y: site.y, z: Math.min(...manufacturedIndices) }, { x: site.x, y: site.y, z: Math.max(...manufacturedIndices) }] })
        bindings.push({ traceIndex, pointIndex: index, pcb_trace_id: trace.pcb_trace_id, connection_name: trace.connection_name, owner, rawPoint: point, site })
      } else if (point.route_type === "wire" && next?.route_type === "wire" && point.layer === next.layer) {
        routes.push({ connectionName: owner.owner, rootConnectionName: owner.owner, traceThickness: Math.max(point.width, next.width), viaDiameter: original.minViaDiameter ?? 0.3, vias: [], route: [{ x: point.x, y: point.y, z: stack.indexOf(point.layer) }, { x: next.x, y: next.y, z: stack.indexOf(next.layer) }] })
        bindings.push({ traceIndex, pointIndex: index, pcb_trace_id: trace.pcb_trace_id, connection_name: trace.connection_name, owner, rawSegment: [point, next] })
      }
    }
  }
  const bind = (finding: { routeIndex: number; obstacleIndex: number }, routeBindings: OriginalIntentJson[], evaluatedRoutes: HighDensityRoute[]): OriginalIntentJson => {
    const obstacle = original.obstacles[finding.obstacleIndex], route = evaluatedRoutes[finding.routeIndex], binding = routeBindings[finding.routeIndex]
    if (!obstacle || !route || !binding) throw new Error("Detailed geometry finding has no exact original/raw participants")
    return { finding, route, raw: binding, originalObstacleIndex: finding.obstacleIndex, originalObstacle: obstacle, originalObstacleOwner: owners.obstacle(obstacle) }
  }
  const fixed = obstacles.length === 0 ? [] : getFixedObstacleViolations({ srj: { ...original, traces: undefined, connections: [], obstacles }, routes })
  const viaRoutes: HighDensityRoute[] = sites.map((site) => {
    const indices = site.layers.map((layer) => stack.indexOf(layer))
    return { connectionName: site.owner, rootConnectionName: site.owner, traceThickness: original.minTraceWidth, viaDiameter: site.diameter,
      vias: [{ x: site.x, y: site.y }], route: [{ x: site.x, y: site.y, z: Math.min(...indices) }, { x: site.x, y: site.y, z: Math.max(...indices) }] }
  })
  const policy = getNewViaPadViolations({ srj: { ...original, traces: undefined, connections: [], obstacles }, previousRoutes: viaRoutes, routes: viaRoutes,
    viaClearance: getViaToPadClearance(original) ?? 0.1, includeExistingVias: viaRoutes.map((_, routeIndex) => ({ routeIndex, viaIndex: 0 })) })
  if (native.errors.length !== certificate.referenceErrorCount || fixed.length !== certificate.srjObstacleViolationCount || policy.length !== certificate.viaPadPolicyViolationCount || viaInPad.length !== certificate.viaInPadViolationCount) throw new Error("Detailed geometry predicates differ from the full certificate")
  return structuredClone({
    nativeErrors: native.errors as OriginalIntentJson[], nativeErrorsWithCenters: native.errorsWithCenters as OriginalIntentJson[], nativeLocationAwareErrors: native.locationAwareErrors as OriginalIntentJson[],
    viaInPad: viaInPad as OriginalIntentJson[], srjObstacles: fixed.map((finding) => bind(finding, bindings, routes)),
    viaPadPolicy: policy.map((finding) => bind(finding, sites, viaRoutes)), boardReasons: checkBoardEnvelope(original, traces, sites),
  })
}
