import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
export function getPadNet(
  map: ConnectivityMap,
  nets: Map<string, string>,
  identity: string,
): string {
  const cached = nets.get(identity)
  if (cached !== undefined) return cached
  let net = map.getNetConnectedToId(identity)
  if (net === undefined) {
    const member = map.getIdsConnectedToNet(identity)[0]
    if (member === undefined) net = identity
    else net = map.getNetConnectedToId(member)
  }
  if (net === undefined)
    throw new Error(
      `PadJunctionSimplificationSolver: net missing for "${identity}"`,
    )
  nets.set(identity, net)
  return net
}
