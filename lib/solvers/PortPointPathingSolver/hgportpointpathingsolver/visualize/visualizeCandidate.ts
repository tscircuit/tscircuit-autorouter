import type { GraphicsObject, Point } from "graphics-debug"
import type { CandidateHg } from "../types"

/** Draws the current best candidate path and queue candidates for inspection. */
export function visualizeCandidate(
  candidates: CandidateHg[] | undefined,
  startPoint: Point,
): GraphicsObject | null {
  const graphics: GraphicsObject = {
    lines: [],
    points: [],
  }

  if (!candidates) {
    return graphics
  }

  let currentCandidate = candidates.shift()
  if (!currentCandidate) {
    return graphics
  }

  const currentCandidatePathPoints: Array<{ x: number; y: number; z: number }> =
    []
  graphics.points!.push({
    ...currentCandidate.port.d,
    color: "rgb(255, 50, 50)",
    label: `g: ${currentCandidate.g}\nh: ${currentCandidate.h}\nf: ${currentCandidate.f}\nripRequired: ${currentCandidate.ripRequired}`,
  })

  do {
    currentCandidatePathPoints.push({
      x: currentCandidate.port.d.x,
      y: currentCandidate.port.d.y,
      z: currentCandidate.port.d.z,
    })
    currentCandidate = currentCandidate.parent
  } while (currentCandidate)
  currentCandidatePathPoints.reverse()

  const startZ = currentCandidatePathPoints[0]?.z ?? 0
  currentCandidatePathPoints.unshift({
    x: startPoint.x,
    y: startPoint.y,
    z: startZ,
  })

  for (let i = 0; i < currentCandidatePathPoints.length - 1; i++) {
    const pointA = currentCandidatePathPoints[i]
    const pointB = currentCandidatePathPoints[i + 1]
    const sameLayer = pointA.z === pointB.z
    let strokeDash: string | undefined
    if (sameLayer) {
      strokeDash = pointA.z === 0 ? undefined : "10 5"
    } else {
      strokeDash = "3 3 10"
    }

    graphics.lines!.push({
      points: [
        { x: pointA.x, y: pointA.y },
        { x: pointB.x, y: pointB.y },
      ],
      strokeColor: "rgba(255, 250, 50, 1)",
      strokeWidth: 0.01,
      strokeDash,
    })
  }

  for (const candidate of candidates) {
    graphics.points!.push({
      ...candidate.port.d,
      color: "rgb(0, 64, 255)",
      label: `${candidate.port.portId}\ng: ${candidate.g}\nh: ${candidate.h}\nf: ${candidate.f}\nripRequired: ${candidate.ripRequired}`,
    })
  }

  return graphics
}
