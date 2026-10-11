let nextId = 0

/** Contexts and frontier snapshots share one ID space across all coordinators. */
export function allocateParallelGlobalDrcId(): number {
  const allocated = ++nextId
  if (!Number.isSafeInteger(allocated)) {
    throw new Error("Parallel global DRC identifier space was exhausted")
  }
  return allocated
}
