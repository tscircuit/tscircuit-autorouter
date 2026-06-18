import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { getTinyPortMetadata } from "./tinyHypergraphMetadata"
import type { HgPortPointPathingSolverParams } from "./types"

export const toSerializedPortData = (
  port: HgPortPointPathingSolverParams["graph"]["ports"][number],
): SerializedHyperGraph["ports"][number]["d"] => {
  const portMetadata = getTinyPortMetadata(port.d)

  return {
    portId: port.d.portId,
    x: port.d.x,
    y: port.d.y,
    z: port.d.z,
    prevPortPointId: portMetadata.prevPortPointId,
    nextPortPointId: portMetadata.nextPortPointId,
    distToCentermostPortOnZ: port.d.distToCentermostPortOnZ,
    tinyHypergraphPortPenalty: port.d.tinyHypergraphPortPenalty,
    cramped: port.d.cramped,
  }
}
