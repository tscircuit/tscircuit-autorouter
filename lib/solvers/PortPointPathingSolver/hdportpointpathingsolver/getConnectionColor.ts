export const getConnectionColor = (
  connectionId: string,
  alpha = 0.8,
): string => {
  let hash = 0
  for (let i = 0; i < connectionId.length; i++) {
    hash = connectionId.charCodeAt(i) * 17777 + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  return `hsla(${hue}, 100%, 10%, ${alpha})`
}
