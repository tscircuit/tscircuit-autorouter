import { isReferenceDrcNativeInternScopeActive } from "./referenceDrcNativeInternScope"

type Member = { value: string; next: Member | undefined }
type Network = { parent: Network | undefined; name: string; head: Member | undefined; tail: Member | undefined }

/** Only the closed Native checker creates these fresh ordered connection rows.
 * Public/unscoped calls retain the literal helper. Directed unions preserve
 * Native network names and concatenate disjoint member encounter orders. */
export function findPrivatelyScopedOrderedConnectedNetworks(
  memo: unknown,
  connections: string[][],
): Record<string, string[]> | undefined {
  // Membership consumes neither caller properties nor a supplied trust token.
  if (!isReferenceDrcNativeInternScopeActive(memo)) return undefined
  // The private checker guard proves source and runtime immutability. This
  // additional domain test keeps unsupported ID coercion on the literal path.
  for (let i = 0; i < connections.length; i++) {
    const row = connections[i]!
    for (let j = 0; j < row.length; j++) if (typeof row[j] !== "string") return undefined
  }
  const active = new Map<string, Network>()
  const membership = new Map<string, Network>()
  let netCounter = 0
  const find = (entry: Network): Network => {
    let root = entry
    while (root.parent !== undefined) root = root.parent
    while (entry.parent !== undefined) {
      const next = entry.parent
      entry.parent = root
      entry = next
    }
    return root
  }
  const getOrCreate = (nodeId: string): Network => {
    const existing = membership.get(nodeId)
    if (existing !== undefined) return find(existing)
    const network: Network = {
      parent: undefined,
      name: `connectivity_net${netCounter++}`,
      head: undefined,
      tail: undefined,
    }
    active.set(network.name, network)
    return network
  }
  for (const connection of connections) {
    let network: Network | undefined
    for (const nodeId of connection) {
      if (network === undefined) network = getOrCreate(nodeId)
      else {
        const assigned = membership.get(nodeId)
        if (assigned === undefined || find(assigned) !== network) {
          const other = getOrCreate(nodeId)
          if (other !== network) {
            // Distinct active roots have disjoint IDs. A directed append is
            // therefore exactly the original ordered Set.add(member) loop.
            if (other.head !== undefined) {
              if (network.tail !== undefined) network.tail.next = other.head
              else network.head = other.head
              network.tail = other.tail
            }
            other.parent = network
            active.delete(other.name)
          }
        }
      }
      if (membership.get(nodeId) === undefined) {
        const member: Member = { value: nodeId, next: undefined }
        if (network.tail === undefined) network.head = member
        else network.tail.next = member
        network.tail = member
        membership.set(nodeId, network)
      }
    }
  }
  const rows: [string, string[]][] = []
  for (const [name, network] of active) {
    const members: string[] = []
    for (let member = network.head; member !== undefined; member = member.next) members.push(member.value)
    rows.push([name, members])
  }
  return Object.fromEntries(rows)
}
