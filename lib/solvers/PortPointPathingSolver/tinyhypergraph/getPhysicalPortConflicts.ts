type PortCoordinates = {
  portX: ArrayLike<number>
  portY: ArrayLike<number>
  portZ: ArrayLike<number>
}

/** Ports on different boundaries can still describe overlapping copper. */
export const getPhysicalPortConflicts = (
  coordinates: PortCoordinates,
  minPortSpacing: number,
): number[][] => {
  if (!Number.isFinite(minPortSpacing) || minPortSpacing <= 0) {
    throw new Error("Physical port spacing must be finite and positive")
  }
  const conflicts: number[][] = Array.from(
    { length: coordinates.portX.length },
    () => [],
  )
  const buckets = new Map<string, number[]>()
  for (let port = 0; port < coordinates.portX.length; port++) {
    const x = coordinates.portX[port]!
    const y = coordinates.portY[port]!
    const z = coordinates.portZ[port]!
    const bucketX = Math.floor(x / minPortSpacing)
    const bucketY = Math.floor(y / minPortSpacing)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const neighbors = buckets.get(`${z}:${bucketX + dx}:${bucketY + dy}`)
        if (!neighbors) continue
        for (const other of neighbors) {
          if (
            Math.hypot(
              x - coordinates.portX[other]!,
              y - coordinates.portY[other]!,
            ) >=
            minPortSpacing - 1e-6
          )
            continue
          conflicts[port]!.push(other)
          conflicts[other]!.push(port)
        }
      }
    }
    const key = `${z}:${bucketX}:${bucketY}`
    const bucket = buckets.get(key) ?? []
    bucket.push(port)
    buckets.set(key, bucket)
  }
  return conflicts
}
