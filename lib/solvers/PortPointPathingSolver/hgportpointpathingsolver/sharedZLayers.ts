/** Returns the z-layers that are present in both input layer lists. */
export function sharedZLayers(layer1: number[], layer2: number[]): number[] {
  const shared = []
  for (const z1 of layer1) {
    if (layer2.includes(z1)) {
      shared.push(z1)
    }
  }
  return shared
}
