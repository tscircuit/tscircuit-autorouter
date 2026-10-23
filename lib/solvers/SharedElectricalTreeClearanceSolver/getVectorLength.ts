// Native Math.hypot can round differently between platforms.
// Scaling avoids overflow and underflow when squaring the coordinates.
export const getVectorLength = (x: number, y: number): number => {
  const scale = Math.max(Math.abs(x), Math.abs(y))
  if (scale === 0 || scale === Number.POSITIVE_INFINITY) return scale
  const scaledX = x / scale
  const scaledY = y / scale
  return scale * Math.sqrt(scaledX * scaledX + scaledY * scaledY)
}
