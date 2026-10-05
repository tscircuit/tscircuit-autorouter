import { MHPoint2 } from "./types2"
import { createSymmetricArray } from "./createSymmetricArray"

export const constructMiddlePointsWithViaPositions = (params: {
  start: MHPoint2
  end: MHPoint2
  segmentsPerPolyline: number
  viaCount: number
  availableZ: number[]
  viaPositions: Array<{ x: number; y: number }>
}) => {
  const {
    start,
    end,
    segmentsPerPolyline,
    viaPositions,
    viaCount,
    availableZ,
  } = params

  const viaIndices = createSymmetricArray(segmentsPerPolyline, viaCount)
  const middlePoints: (MHPoint2 | null)[] = viaIndices.map(() => null)

  let viasAdded = 0
  let lastZ = start.z1
  const availableZOffset = availableZ.indexOf(start.z1)
  for (let i = 0; i < viaIndices.length; i++) {
    if (viaIndices[i] === 1) {
      const nextZ =
        availableZ[(availableZOffset + viasAdded + 1) % availableZ.length]
      middlePoints[i] = {
        ...viaPositions[viasAdded],
        z1: lastZ,
        z2: nextZ,
      }
      lastZ = nextZ
      viasAdded++
    }
  }

  let left: MHPoint2 = start
  for (let i = 0; i < middlePoints.length; i++) {
    if (middlePoints[i]) {
      left = middlePoints[i]!
      continue
    }
    let right: MHPoint2 = end
    let rightIndex: number = middlePoints.length
    for (let u = i + 1; u < middlePoints.length; u++) {
      if (middlePoints[u]) {
        right = middlePoints[u]!
        rightIndex = u
        break
      }
    }

    const N = rightIndex - i
    const dx = right.x - left.x
    const dy = right.y - left.y
    for (let t = 1 / (N + 1), ti = 0; ; t += 1 / (N + 1), ti++) {
      if (i + ti === rightIndex) break
      middlePoints[i + ti] = {
        x: left.x + dx * t,
        y: left.y + dy * t,
        z1: left.z2,
        z2: left.z2,
      }
    }
  }

  return middlePoints as unknown as MHPoint2[]
}
