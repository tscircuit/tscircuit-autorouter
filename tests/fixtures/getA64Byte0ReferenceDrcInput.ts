import type { EvaluateRelaxedDrcInput } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

/** Add checker identities to a clone, retaining every original pad geometry. */
export function getA64Byte0ReferenceDrcInput({
  inputSrj,
  routedTraces,
}: {
  inputSrj: SimpleRouteJson
  routedTraces: SimplifiedPcbTrace[]
}): EvaluateRelaxedDrcInput {
  const reference = structuredClone(inputSrj)
  const terminalIds = new Set(
    reference.connections.flatMap((connection) =>
      connection.pointsToConnect.map((point) => {
        if (!point.pointId) {
          throw new Error("A64 terminal has no source point id")
        }
        point.pcb_port_id = point.pointId
        return point.pointId
      }),
    ),
  )
  for (const obstacle of reference.obstacles) {
    if (obstacle.isNonPlatedHole || obstacle.isCopperPour) continue
    if (!obstacle.obstacleId) throw new Error("A64 pad has no source identity")
    const pcbPortId = obstacle.connectedTo.find((id) => terminalIds.has(id))
    obstacle.circuitJsonMetadata = {
      ...obstacle.circuitJsonMetadata,
      ...(obstacle.layers.length === 1
        ? { pcb_smtpad_id: obstacle.obstacleId }
        : { pcb_plated_hole_id: obstacle.obstacleId }),
      ...(pcbPortId ? { pcb_port_id: pcbPortId } : {}),
    }
  }
  return {
    inputSrj: reference,
    srjWithPointPairs: reference,
    routedTraces,
    includeBoardClearance: true,
    drcOptions: { traceClearance: inputSrj.defaultObstacleMargin },
  }
}
