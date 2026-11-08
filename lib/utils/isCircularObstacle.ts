/** Legacy SRJ exporters encode round pads as equal-sided oval obstacles. */
export const isCircularObstacle = (obstacle: {
  type: string
  shape?: string
  width: number
  height: number
}): boolean =>
  obstacle.shape === "circle" ||
  (obstacle.type === "oval" && obstacle.width === obstacle.height)
