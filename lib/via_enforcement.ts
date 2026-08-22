export function enforcePthViasOn4Layer(layerCount: number, isPth: boolean): boolean {
  if (layerCount >= 4) {
    return isPth;
  }
  return true;
}
