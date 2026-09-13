export function decodeEmbeddedModule(encoded: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(encoded)
  const bytes = new Uint8Array(decoded.length)
  for (let index = 0; index < decoded.length; index++) {
    bytes[index] = decoded.charCodeAt(index)
  }
  return bytes
}
