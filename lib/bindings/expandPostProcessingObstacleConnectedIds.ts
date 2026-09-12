import { expandPostProcessingObstacleConnectedIds as expandNative } from "../../rust/autorouter-bindings/pkg/autorouter_bindings.js"
import { initializeAutorouterBindings } from "./initializeAutorouterBindings"

export const expandPostProcessingObstacleConnectedIds = (
  aliasesByRoute: string[][],
  connectedToByObstacle: string[][],
): (string[] | null)[] => {
  initializeAutorouterBindings()
  const strings: string[] = []
  const ids = new Map<string, number>()
  const intern = (value: string): number => {
    const existing = ids.get(value)
    if (existing !== undefined) return existing
    const id = strings.length
    ids.set(value, id)
    strings.push(value)
    return id
  }
  const result: (number[] | null)[] = JSON.parse(expandNative(JSON.stringify({
    aliasesByRoute: aliasesByRoute.map((aliases) => aliases.map(intern)),
    connectedToByObstacle: connectedToByObstacle.map((names) => names.map(intern)),
  })))
  return result.map((names) => names === null ? null : names.map((id) => {
    if (!Number.isInteger(id) || id < 0 || id >= strings.length) {
      throw new Error(`Native obstacle expansion returned unknown string ID ${id}`)
    }
    return strings[id]!
  }))
}
