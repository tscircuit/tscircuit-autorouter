import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import type { PhysicalPadElement } from "../../lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "../../lib/types"

const cachedPads = new Map<string, readonly PhysicalPadElement[]>()

/** Load only original CAD pads/holes; original routed copper must not prove new routes. */
export const loadSrj18PhysicalPadElements = (
  srj: SimpleRouteJson,
): readonly PhysicalPadElement[] | undefined => {
  const path = (srj as SimpleRouteJson & { sourceCircuitJson?: unknown }).sourceCircuitJson
  if (path === undefined) return undefined
  if (typeof path !== "string" || !/^circuit-json\/sample\d{3}-[a-z0-9-]+\.json$/.test(path)) {
    throw new Error("Invalid original SRJ18 Circuit JSON path")
  }
  const cached = cachedPads.get(path)
  if (cached) return cached
  const datasetRoot = dirname(createRequire(import.meta.url).resolve("dataset-srj18"))
  const parsed: unknown = JSON.parse(readFileSync(join(datasetRoot, path), "utf8"))
  if (!Array.isArray(parsed)) throw new Error(`Invalid original SRJ18 Circuit JSON: ${path}`)
  const pads: PhysicalPadElement[] = []
  const ids = new Set<string>()
  for (const element of parsed) {
    if (element === null || typeof element !== "object" || typeof element.type !== "string") {
      throw new Error(`Malformed original SRJ18 Circuit JSON element: ${path}`)
    }
    if (element.type !== "pcb_smtpad" && element.type !== "pcb_plated_hole" && element.type !== "pcb_hole") continue
    const id: unknown = element[`${element.type}_id`]
    if (typeof id !== "string" || id.length === 0 || ids.has(id)) {
      throw new Error(`Invalid original SRJ18 physical pad identity: ${path}`)
    }
    ids.add(id)
    pads.push(element as PhysicalPadElement)
  }
  if (pads.length === 0) throw new Error(`Missing original SRJ18 physical pads: ${path}`)
  cachedPads.set(path, pads)
  return pads
}
