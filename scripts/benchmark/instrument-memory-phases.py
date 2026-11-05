from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text()
markers={
'    const traces = solver.failed': 'before-output-traces',
'    const traceLinter = runTraceLinting': 'before-trace-lint',
'    const viaCount = countTraceVias': 'after-trace-lint',
'    const relaxedDrcPassed = errors.length === 0': 'after-final-drc',
'  const imageSvg = getSvgFromGraphicsObject': 'before-svg-render',
'    } catch (error) {\n      console.error(\n        `[benchmark-snapshot]': 'after-snapshot',
}
for marker,phase in markers.items():
    assert s.count(marker)==1,(marker,s.count(marker))
    indent=marker[:len(marker)-len(marker.lstrip())]
    statement=indent+'console.error("[memory-phase]", JSON.stringify({phase:"'+phase+'", ...process.memoryUsage(), peakRssBytes: process.resourceUsage().maxRSS * 1024}))\n'
    s=s.replace(marker,statement+marker,1)
p.write_text(s)
