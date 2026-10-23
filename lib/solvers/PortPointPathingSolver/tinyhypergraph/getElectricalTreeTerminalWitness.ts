import type { ElectricalTreeTerminalWitness, SimpleRouteConnection } from "lib/types/srj-types"
import { getConnectionPointLayers } from "lib/types/srj-types"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

/** A generic SRJ terminal is fixed without inventing a PCB pad identifier. */
export function getElectricalTreeTerminalWitness(connection: SimpleRouteConnection, endpoint: 0 | 1, layerCount?: number): ElectricalTreeTerminalWitness | undefined {
  const witness = connection.electricalBranch?.originalTerminals?.[endpoint === 0 ? "start" : "end"]
  if (!witness) return undefined
  if (!Number.isInteger(layerCount) || layerCount! < 1) throw new Error(`Electrical tree original terminal validation requires the board layers on ${connection.name}`)
  const expected = connection.pointsToConnect[endpoint]
  if (!expected || !witness.sourceConnectionName.length || (witness.sourceEndpointIndex !== 0 && witness.sourceEndpointIndex !== 1) ||
    ![witness.x, witness.y].every(Number.isFinite) || !Number.isInteger(witness.z) || witness.z < 0 || !witness.layer.length ||
    expected.x !== witness.x || expected.y !== witness.y || !getConnectionPointLayers(expected).includes(witness.layer) ||
    (witness.sourcePointId !== null && (typeof witness.sourcePointId !== "string" || expected.pointId !== witness.sourcePointId)) ||
    witness.z >= layerCount! || mapZToLayerName(witness.z, layerCount!) !== witness.layer) {
    throw new Error(`Electrical tree lost original terminal witness on ${connection.name}`)
  }
  return witness
}
