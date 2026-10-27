import type { ConnectionPoint, SimplifiedPcbTrace } from "lib/types"

type WirePoint = Extract<
  SimplifiedPcbTrace["route"][number],
  { route_type: "wire" }
>

/** Include the terminal and optional elbow; retain the actual grid point separately. */
export const getOctilinearKrtTerminalConnector = ({
  terminal,
  gridPoint,
}: {
  terminal: ConnectionPoint
  gridPoint: WirePoint
}): WirePoint[] => {
  const dx = gridPoint.x - terminal.x
  const dy = gridPoint.y - terminal.y
  const connector: WirePoint[] = [
    { ...gridPoint, x: terminal.x, y: terminal.y },
  ]
  if (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) return connector
  const diagonal = Math.min(Math.abs(dx), Math.abs(dy))
  const elbow = { ...gridPoint, x: terminal.x, y: terminal.y }
  if (Math.abs(dx) > Math.abs(dy)) {
    elbow.x = gridPoint.x - Math.sign(dx) * diagonal
  } else {
    elbow.y = gridPoint.y - Math.sign(dy) * diagonal
  }
  connector.push(elbow)
  return connector
}
