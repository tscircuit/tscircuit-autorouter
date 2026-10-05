export function getCompleteAxisCoordinates(
  axisCoordinates: number[],
  pitch: number,
): number[] {
  const completeAxisCoordinates: number[] = []

  for (let index = 0; index < axisCoordinates.length; index++) {
    const currentCoordinate = axisCoordinates[index]!
    completeAxisCoordinates.push(currentCoordinate)

    const nextCoordinate = axisCoordinates[index + 1]
    if (nextCoordinate === undefined) continue

    const slotDistance = Math.round(
      (nextCoordinate - currentCoordinate) / pitch,
    )
    if (slotDistance <= 1) continue

    for (let slotOffset = 1; slotOffset < slotDistance; slotOffset++) {
      const interpolationFraction = slotOffset / slotDistance
      completeAxisCoordinates.push(
        Number(
          (
            currentCoordinate +
            (nextCoordinate - currentCoordinate) * interpolationFraction
          ).toFixed(6),
        ),
      )
    }
  }

  return completeAxisCoordinates
}
