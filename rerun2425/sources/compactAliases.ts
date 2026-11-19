type RoutingInput = {
  obstacles: { connectedTo: string[]; [key: string]: unknown }[]
  [key: string]: unknown
}

/** Preserve every routing reference and every obstacle-to-obstacle electrical
 * intersection. Each compacted alias component must have an original alias
 * common to all its obstacles; otherwise this experiment fails explicitly.
 */
export function compactAliases(input: RoutingInput): { input: RoutingInput; before: number; after: number; components: number } {
  const parents = new Map<string, string>()
  const find = (id: string): string => {
    if (!parents.has(id)) parents.set(id, id)
    let root = id
    while (parents.get(root) !== root) root = parents.get(root)!
    let cursor = id
    while (parents.get(cursor) !== root) {
      const next = parents.get(cursor)!
      parents.set(cursor, root)
      cursor = next
    }
    return root
  }
  const required = new Set<string>()
  const collect = (value: unknown, target: Set<string>, key = ""): void => {
    if (key === "connectedTo") return
    if (typeof value === "string") target.add(value)
    else if (Array.isArray(value)) for (const item of value) collect(item,target)
    else if (value && typeof value === "object") for (const [name, item] of Object.entries(value)) collect(item,target,name)
  }
  for (const [key,value] of Object.entries(input)) if(key!=="obstacles")collect(value,required,key)
  for (const obstacle of input.obstacles) {
    const ids = obstacle.connectedTo
    if (!ids.length) continue
    const root = find(ids[0])
    for (const id of ids) parents.set(find(id), root)
  }
  const shared = new Map<string, Set<string>>()
  for (const obstacle of input.obstacles) {
    if (!obstacle.connectedTo.length) continue
    const root = find(obstacle.connectedTo[0])
    const ids = new Set(obstacle.connectedTo)
    const intersection = shared.get(root)
    if (!intersection) shared.set(root, ids)
    else for (const id of intersection) if (!ids.has(id)) intersection.delete(id)
  }
  const canonical = new Map<string, string>()
  for (const [root, intersection] of shared) {
    if (!intersection.size) throw new Error(`Alias component ${root} is not a clique; cannot safely compact it`)
    canonical.set(root, [...intersection].sort((a, b) => Number(!a.startsWith("source_net_"))-Number(!b.startsWith("source_net_")) || a.localeCompare(b))[0])
  }
  let before = 0, after = 0
  const obstacles = input.obstacles.map((obstacle) => {
    before += obstacle.connectedTo.length
    const local = new Set<string>()
    collect(obstacle,local)
    const retained = obstacle.connectedTo.filter((id,index) => index===0 || required.has(id) || local.has(id))
    if (obstacle.connectedTo.length) retained.push(canonical.get(find(obstacle.connectedTo[0]))!)
    const connectedTo = [...new Set(retained)]
    const original = new Set(obstacle.connectedTo)
    if (connectedTo.some((id) => !original.has(id))) throw new Error("Compaction introduced a foreign electrical alias")
    if (obstacle.connectedTo.some((id) => required.has(id) && !connectedTo.includes(id))) throw new Error("Compaction removed a referenced electrical alias")
    after += connectedTo.length
    return { ...obstacle, connectedTo }
  })
  return { input: { ...input, obstacles }, before, after, components: canonical.size }
}
