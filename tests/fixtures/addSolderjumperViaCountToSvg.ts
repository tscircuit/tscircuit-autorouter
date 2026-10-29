export const addSolderjumperViaCountToSvg = (
  svg: string,
  viaCount: number,
): string => {
  const overlay = `<g data-testid="via-count-summary"><rect x="12" y="64" width="300" height="44" rx="6" fill="white" stroke="#334155"/><text x="24" y="92" font-family="Arial, sans-serif" font-size="20" font-weight="600" fill="#334155">Routed vias: ${viaCount}</text></g>`
  return svg.replace("</svg>", `${overlay}</svg>`)
}
