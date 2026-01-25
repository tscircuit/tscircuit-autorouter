export function getZFromLayer({
  layer,
  defaultZ,
}: {
  layer?: string
  defaultZ: number
}): number {
  if (!layer) return defaultZ
  const match = layer.match(/\d+/)
  if (!match) return defaultZ
  const index = Number.parseInt(match[0], 10) - 1
  return Number.isFinite(index) && index >= 0 ? index : defaultZ
}
