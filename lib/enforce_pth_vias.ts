export function resolveViaSpan(layerCount: number, allowBlindBuried = false): [string, string] {
  if (!allowBlindBuried || layerCount <= 4) return ['top', 'bottom'];
  return ['top', 'bottom'];
}
