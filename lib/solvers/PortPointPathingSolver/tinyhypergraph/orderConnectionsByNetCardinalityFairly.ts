export const orderConnectionsByNetCardinalityFairly = <TConnection>(
  connections: readonly TConnection[],
  getNetId: (connection: TConnection) => string | number,
): TConnection[] => {
  const connectionsByNetId = new Map<string | number, TConnection[]>()
  for (const connection of connections) {
    const netId = getNetId(connection)
    const netConnections = connectionsByNetId.get(netId) ?? []
    netConnections.push(connection)
    connectionsByNetId.set(netId, netConnections)
  }

  const netGroups = [...connectionsByNetId.values()]
    .sort((left, right) => right.length - left.length)
    .map((netConnections) => ({
      netConnections,
      nextConnectionIndex: 0,
      schedulingCredit: 0,
    }))
  const orderedConnections: TConnection[] = []

  while (orderedConnections.length < connections.length) {
    let selectedGroup: (typeof netGroups)[number] | undefined
    for (const netGroup of netGroups) {
      if (netGroup.nextConnectionIndex >= netGroup.netConnections.length) {
        continue
      }
      netGroup.schedulingCredit += netGroup.netConnections.length
      if (
        !selectedGroup ||
        netGroup.schedulingCredit > selectedGroup.schedulingCredit
      ) {
        selectedGroup = netGroup
      }
    }

    const nextConnection =
      selectedGroup?.netConnections[selectedGroup.nextConnectionIndex]
    if (!selectedGroup || !nextConnection) {
      throw new Error("Failed to schedule every tiny-hypergraph connection")
    }
    orderedConnections.push(nextConnection)
    selectedGroup.nextConnectionIndex += 1
    selectedGroup.schedulingCredit -= connections.length
  }

  return orderedConnections
}
