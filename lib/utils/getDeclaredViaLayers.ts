import { mapZToLayerName } from "./mapZToLayerName"

type DeclaredViaLayersOptions = {
  layerCount: number
  fromLayer: string
  toLayer: string
  allowBlindAndBuriedVias?: boolean
  layers?: string[]
}

/** Resolve an explicit manufacturing policy without inventing one for legacy SRJ. */
export const getDeclaredViaLayers = ({
  layerCount,
  fromLayer,
  toLayer,
  allowBlindAndBuriedVias,
  layers,
}: DeclaredViaLayersOptions): string[] => {
  if (allowBlindAndBuriedVias === undefined) {
    return layers ?? [fromLayer, toLayer]
  }
  if (!Number.isInteger(layerCount) || layerCount < 1) {
    throw new Error(`Invalid board layer count: ${layerCount}`)
  }
  const boardLayers: string[] = Array.from({ length: layerCount }, (_, z) =>
    mapZToLayerName(z, layerCount),
  )
  const from = boardLayers.indexOf(fromLayer)
  const to = boardLayers.indexOf(toLayer)
  if (from < 0 || to < 0) {
    throw new Error(`Via transition ${fromLayer} -> ${toLayer} is outside the board`)
  }
  if (!allowBlindAndBuriedVias) return boardLayers
  if (!layers) {
    return boardLayers.slice(Math.min(from, to), Math.max(from, to) + 1)
  }
  const occupied = new Set(layers)
  const ordered = boardLayers.filter((layer) => occupied.has(layer))
  const first = boardLayers.indexOf(ordered[0]!)
  const last = boardLayers.indexOf(ordered[ordered.length - 1]!)
  if (
    !occupied.has(fromLayer) ||
    !occupied.has(toLayer) ||
    ordered.length !== layers.length ||
    last - first + 1 !== ordered.length
  ) {
    throw new Error("Via layers must form a board span containing the transition")
  }
  return ordered
}
