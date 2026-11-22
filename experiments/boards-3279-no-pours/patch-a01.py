from pathlib import Path
import hashlib, json, re, sys

runtime = Path(sys.argv[1])
package = runtime / 'node_modules/@tscircuit/capacity-autorouter'
helper = '''isViaBlockedByPort({row,col,activeConn}){
if(this.viaMinDistFromPort===undefined)return false;
const transform=this.gridToBoundsTransform;
const x=this.gridOrigin.x+(col+0.5)*this.cellSizeMm;
const y=this.gridOrigin.y+(row+0.5)*this.cellSizeMm;
const center={x:transform.a*x+transform.b*y+transform.c,y:transform.d*x+transform.e*y+transform.f};
const requiredDistance=this.viaMinDistFromPort;
const root=this.connIdToRootNet[activeConn];
return this.nodeWithPortPoints.portPoints.some(port=>(port.rootConnectionName??port.connectionName.replace(/_mst\\d+$/,""))!==root&&(port.x-center.x)**2+(port.y-center.y)**2<requiredDistance**2)
}'''
provenance = []
for path in sorted((package / 'dist').glob('**/*.js')):
    source = path.read_text()
    marker = 'getSolverName(){return"HighDensitySolverA01"}'
    if marker not in source:
        continue
    assert source.count(marker) == 1, path
    start = source.index(marker)
    method = source.index('computeMoveCostAndRips(', start)
    # Calls precede the method declaration. Locate its closing signature/body.
    method_match = re.search(r'\}computeMoveCostAndRips\([^)]*\)\{', source[method:])
    assert method_match, path
    insert_at = method + method_match.start() + 1
    via = re.compile(r'([a-zA-Z_$][\w$]*)>=this.minViaRow&&\1<=this.maxViaRow&&([a-zA-Z_$][\w$]*)>=this.minViaCol&&\2<=this.maxViaCol')
    matches = list(via.finditer(source, start, insert_at))
    assert len(matches) == 1, (path, len(matches))
    match = matches[0]
    condition = match.group(0) + f'&&!this.isViaBlockedByPort({{row:{match[1]},col:{match[2]},activeConn:this.activeConnId}})'
    patched = source[:insert_at] + helper + source[insert_at:]
    patched = patched[:match.start()] + condition + patched[match.end():]
    constructor = re.search(r'this\.viaDiameter=([\w$]+)\.viaDiameter', patched[start:])
    assert constructor, path
    constructor_at = start + constructor.end()
    patched = patched[:constructor_at] + f',this.viaMinDistFromPort={constructor[1]}.viaMinDistFromPort' + patched[constructor_at:]
    portfolio = re.search(r'HIGH_DENSITY_A01\)\{return new [\w$]+\(\{nodeWithPortPoints:this.nodeWithPortPoints,([^}]+)', patched)
    assert portfolio, path
    margin = re.search(r'traceMargin:([\w$]+),', portfolio[1])
    assert margin, path
    field = 'viaMinDistFromPort:this.constructorParams.preservePhysicalGeometry&&this.constructorParams.allowBlindAndBuriedVias===false?((this.constructorParams.viaDiameter??.3)+(this.constructorParams.traceWidth??.15))/2+' + margin[1] + ':undefined,'
    config_at = portfolio.start(1)
    patched = patched[:config_at] + field + patched[config_at:]
    path.write_text(patched)
    provenance.append({'file': str(path.relative_to(package)), 'before': hashlib.sha256(source.encode()).hexdigest(), 'after': hashlib.sha256(patched.encode()).hexdigest(), 'a01Classes': 1})
assert any(row['file'] == 'dist/index.js' for row in provenance)
report = {'sourceRepo': 'tscircuit/high-density-a01', 'sourceRepro': '429bb0b', 'sourceFix': '20d30e6', 'change': 'A01 supplied through-via port clearance, enabled only for physical regional repairs with blind/buried vias disabled. Original grid, order, costs and budgets retained.', 'bundles': provenance}
Path(sys.argv[2]).write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
