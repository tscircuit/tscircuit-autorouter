const NODE_ID_PATTERNS = [
  /^node:\s*([A-Za-z0-9_-]+)/m,
  /^capacityMeshNodeId:\s*([A-Za-z0-9_-]+)/m,
  /(?:^|[\s(])([A-Za-z0-9_-]*(?:cmn|cn)_[A-Za-z0-9_-]+)(?=$|[\s)])/m,
] as const

export const extractCapacityMeshNodeIdFromObjectLabel = (
  label: string | null | undefined,
): string | null => {
  if (!label) return null

  for (const pattern of NODE_ID_PATTERNS) {
    const match = label.match(pattern)
    if (match?.[1]) {
      return match[1]
    }
  }

  return null
}
