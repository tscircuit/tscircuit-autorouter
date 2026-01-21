const COLOR_PALETTE = [
  "#1f77b4",
  "#ff7f0e",
  "#2ca02c",
  "#d62728",
  "#9467bd",
  "#8c564b",
  "#e377c2",
  "#7f7f7f",
  "#bcbd22",
  "#17becf",
]

/**
 * Get a deterministic color for a connection name.
 */
export function getColorForConnectionName({
  connectionName,
}: {
  connectionName: string
}): string {
  let hash = 0
  for (let i = 0; i < connectionName.length; i++) {
    hash = (hash * 31 + connectionName.charCodeAt(i)) | 0
  }
  const index = Math.abs(hash) % COLOR_PALETTE.length
  return COLOR_PALETTE[index]
}
