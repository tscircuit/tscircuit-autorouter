from pathlib import Path
p=Path('node_modules/@tscircuit/fanout-solver/lib/route-bus/route-analytic-boundary-alternatives.ts');s=p.read_text()
start=s.index('  const trackCandidates = preferredTracks\n')
end=s.index('  for (let trackIndex',start)
block=s[start:end];flat,filter_part=block.split('    .filter(',1)
flat=flat.replace('  const trackCandidates = preferredTracks\n    .flatMap(', '    ...preferredTracks.flatMap(',1)
replacement='''  const trackCandidates = [
    ...preferredTracks.map((value) => ({ value, kind: "preferred" as const })),
'''+flat.rstrip()+''',
  ]
    .filter('''+filter_part
s=s[:start]+replacement+s[end:];p.write_text(s)
