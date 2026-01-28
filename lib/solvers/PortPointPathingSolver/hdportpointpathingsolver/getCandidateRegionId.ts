import type { Candidate } from "@tscircuit/hypergraph"
import type {
  HgPort,
  HgRegion,
} from "lib/solvers/PortPointPathingSolver/hdportpointpathingsolver/buildHyperGraphFromInputNodes"

export function getCandidateRegionId({
  candidate,
}: {
  candidate: Candidate<HgRegion, HgPort>
}): string {
  if (candidate.nextRegion?.regionId) {
    return candidate.nextRegion.regionId
  }
  if (candidate.port.region2?.regionId) {
    return candidate.port.region2.regionId
  }
  return candidate.port.region1.regionId
}
