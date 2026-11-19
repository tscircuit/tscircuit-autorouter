from pathlib import Path
from collections import Counter
import gzip, hashlib, html, json, math, re, statistics, xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
BOARDS = {
    'orangecrab': 'OrangeCrab rev 0.2.1 ECP5 DDR3',
    'h616': 'Allwinner H616 Devboard DDR3',
    'butterstick': 'ButterStick r1.0',
    'glider': 'Glider mainboard',
    'imx6': 'i.MX6 Demo Board',
    'icepi': 'iCE/Pi CM0 SBC',
}
VERSIONS = {'tscircuit': '0.0.3245', 'core': '0.0.2427', 'fanout': '0.0.91', 'capacityAutorouter': '0.0.1134', 'busLanes': '0.0.62', 'bun': '1.4.3'}
COMMITS = {
    'tscircuit': '2fef96503dde3e06e77c3a01a2275428f9da2d22',
    'core': '75ab017cd6852dbe50516ee1f4ca9d1108c29985',
    'capacityAutorouter': 'a4a8f3a71dd66c2cae01d6a7ade426efad833ff6',
    'fanoutBaseline': '3b3511a83410437ab6cc09c995a971bf365b5fa4',
    'measuredFix': 'd06c766646de96a5c723d87250bed846d6c4b292',
    'repro': '48958e9b68adc1fb77a823064d3b80b92efff52b',
    'fix': 'd92cf7dc60300e61d402fc699ff566408dc57b98',
}

def read(relative):
    path = ROOT / relative
    serialized = path.read_bytes()
    return json.loads(gzip.decompress(serialized) if path.suffix == '.gz' else serialized)

def digest(serialized):
    return hashlib.sha256(serialized).hexdigest()

def quantile(samples, fraction):
    ordered = sorted(samples)
    position = (len(ordered) - 1) * fraction
    lower = math.floor(position)
    return ordered[lower] + (ordered[min(lower + 1, len(ordered) - 1)] - ordered[lower]) * (position - lower)

def board_result(cohort, board):
    folder = Path(cohort) / 'boards' / board
    progress, diagnostic, assessment, plan, build, core, package = [read(folder / name) for name in ['progress.json', 'diagnostics.json', 'assessment.json', 'plan.json', 'core-build.json', 'core-package.json', 'runtime-package.json']]
    assert build == {'coreCommit': COMMITS['core'], 'coreVersion': VERSIONS['core']}
    assert core['version'] == VERSIONS['core'] and package['dependencies']['tscircuit'] == VERSIONS['tscircuit']
    expected_fanout = VERSIONS['fanout'] if cohort == 'baseline' else 'https://codeload.github.com/tscircuit/fanout-solver/tar.gz/' + COMMITS['measuredFix']
    assert core['devDependencies']['@tscircuit/fanout-solver'] == expected_fanout
    assert progress['runtime']['routerCommit'] == COMMITS['capacityAutorouter']
    serialized = gzip.decompress((ROOT / folder / 'fanout-1-input.json.gz').read_bytes())
    captured = json.loads(serialized)
    kinds = [phase['autorouter'] for phase in plan['plans']]
    positions = {kind: [index for index, entry in enumerate(kinds) if entry == kind] for kind in ['fanout', 'bus_lanes', 'auto_local']}
    assert max(positions['fanout']) < min(positions['bus_lanes']) and max(positions['bus_lanes']) < min(positions['auto_local'])
    assert plan['initialCopperElements'] == progress['initialCopperElements'] == 0
    physical = [entry for entry in read(folder / 'circuit.json.gz') if not entry['type'].endswith('_error')]
    state = diagnostic['fanoutLastState']
    return {
        'status': progress['status'], 'routingCompleted': progress['status'] == 'completed', 'renderFinished': progress['renderCompleted'],
        'bestPartialConnections': diagnostic['fanoutBestSummary']['routedConnectionCount'], 'requestedConnections': len(captured['solverParams']['connections']),
        'assignmentsReached': state['stats']['assignment'], 'searchExhausted': state['failed'],
        'acceptedTraces': assessment['pcbTraces'], 'acceptedVias': assessment['vias'], 'busPhasesStarted': sum(phase['solver'] == 'BusLanesPipelineSolver' for phase in progress['phases']),
        'inputSha256': digest(serialized), 'sourceSha256': plan['sourceSha256'], 'nonErrorCircuitSha256': digest(json.dumps(physical, sort_keys=True, separators=(',', ':')).encode()),
        'elapsedMs': progress['elapsedMs'], 'firstFanoutMs': progress['phases'][0]['elapsedMs'],
        'geometryErrors': len(assessment['geometryErrors']), 'membershipErrors': len(assessment['membershipErrors']),
        'rules': {key: captured['solverParams'].get(key) for key in ['minTraceWidth', 'minViaPadDiameter', 'minViaHoleDiameter', 'minViaEdgeToPadEdgeClearance', 'allowBlindAndBuriedVias', 'allowViaInPad']},
    }

boards = []
for board, title in BOARDS.items():
    before, after = board_result('baseline', board), board_result('candidate', board)
    for key in ['inputSha256', 'sourceSha256', 'nonErrorCircuitSha256', 'rules', 'requestedConnections']:
        assert before[key] == after[key], (board, key)
    assert before['acceptedTraces'] == after['acceptedTraces'] == before['acceptedVias'] == after['acceptedVias'] == 0
    assert before['geometryErrors'] == after['geometryErrors'] == before['membershipErrors'] == after['membershipErrors'] == 0
    assert before['busPhasesStarted'] == after['busPhasesStarted'] == 0
    boards.append({'board': board, 'title': title, 'before': before, 'after': after})

def paired_result(rows):
    assert len(rows) == 6 and len({row['inputSha256'] for row in rows}) == 1
    assert all(row['failed'] and not row['solved'] and row['copperDrc']['valid'] and not row['copperDrc']['issues'] for row in rows)
    result = {}
    for revision in ['before', 'after']:
        cohort = [row for row in rows if row['revision'] == revision]
        assert len(cohort) == 3 and len({row['copperSha256'] for row in cohort}) == 1
        elapsed = [row['elapsedMs'] for row in cohort]
        result[revision] = {'milliseconds': elapsed, 'medianMs': statistics.median(elapsed), 'meanMs': statistics.mean(elapsed), 'p95Ms': quantile(elapsed, .95), 'bestPartial': cohort[0]['bestPartial'], 'copperSha256': cohort[0]['copperSha256'], 'iterations': cohort[0]['iterations']}
    result['medianReductionPercent'] = 100 * (1 - result['after']['medianMs'] / result['before']['medianMs'])
    result['inputSha256'] = rows[0]['inputSha256']
    result['independentDrcIssues'] = 0
    result['fullSolve'] = False
    return result

paired = {board: paired_result(read(f'paired/{board}/comparison.json')) for board in ['icepi', 'imx6']}
alternative_paired = {board: paired_result(read(f'preparation/paired/{board}/comparison-rows.json')[0]) for board in ['icepi', 'imx6']}
boundary = read('boundary/isolated-boundary-summary.json')
assert boundary['cases'] == 300 and boundary['beforeSolved'] == 235 and boundary['afterSolved'] == 247
assert len(boundary['gains']) == 13 and len(boundary['losses']) == 1
for board in BOARDS:
    pair = read(f'boundary/isolated-boundaries/{board}.json')
    before = next(row['rows'] for row in pair if row['revision'] == 'before')
    after = next(row['rows'] for row in pair if row['revision'] == 'after')
    assert len(before) == len(after)
    for first, second in zip(before, after):
        assert first['connectionName'] == second['connectionName'] and first['inputSha256'] == second['inputSha256']
        for row in [first, second]:
            if row['status'] == 'solved':
                assert row['validation']['valid'] and row['copperDrc']['valid'] and not row['copperDrc']['issues']
drills = {}
for revision in ['before', 'after']:
    cohort = [row for row in read('boundary/accepted-copper-audit.json')[0] if row['revision'] == revision]
    counts = [count for row in cohort for count in row['counts']]
    assert all(row['reportedVias'] == row['traceViaEntries'] == row['distinctDrills'] for row in counts)
    drills[revision] = sum(row['distinctDrills'] for row in counts)
    assert len(counts) == boundary['beforeSolved' if revision == 'before' else 'afterSolved']
assert drills == {'before': 180, 'after': 165}
boundary.update({'acceptedIncreasePercent': 100 * (247 / 235 - 1), 'acceptedRateBeforePercent': 100 * 235 / 300, 'acceptedRateAfterPercent': 100 * 247 / 300, 'rateIncreasePercentagePoints': 4, 'viaReductionPercent': 100 * (1 - 165 / 180), 'distinctViaDrills': drills, 'cohortDefinition': 'All 300 unclaimed singleton boundary requests from the six first-region native inputs, each routed alone with all original obstacles/rules; 10 seconds per request. These are isolated requests, not jointly complete boards.'})

plane_cases = plane_accepted = 0
for board in BOARDS:
    pair = read(f'boundary/isolated-planes/{board}.json')
    before = next(row['rows'] for row in pair if row['revision'] == 'before')
    after = next(row['rows'] for row in pair if row['revision'] == 'after')
    assert len(before) == len(after)
    for first, second in zip(before, after):
        for key in ['busId', 'inputSha256', 'status', 'copperSha256']:
            assert first[key] == second[key], (board, key)
        plane_cases += 1
        if second['status'] == 'solved':
            plane_accepted += 1
            assert second['copperDrc']['valid'] and not second['copperDrc']['issues']
assert plane_cases == 349 and plane_accepted == 292

policy_audit = read('boundary/frozen-policy-audit.json')[0]
frozen_audit = [row for row in policy_audit if '/frozen/inputs/' in row['input']]
native_audit = [row for row in policy_audit if '/captured/' in row['input']]
assert len(frozen_audit) == 72 and all(row['allPreparedBusFieldsIdentical'] and not row['changedDirections'] for row in frozen_audit)
assert len(native_audit) == 6 and sum(len(row['changedDirections']) for row in native_audit) == 117
equivalence = read('boundary/prepared-bus-equivalence.json')[0]
assert len(equivalence) == 78 and all(row['allPreparedBusFieldsIdentical'] for row in equivalence)
canonical = read('preparation/fanout31-matched.json')
assert len(canonical[0]['report']['rows']) == len(canonical[1]['report']['rows']) == 72
assert canonical[0]['svgs'] == canonical[1]['svgs'] and len(canonical[0]['svgs']) == 30
guard = read('boundary/fanout31-matched.json')
assert len(guard[0]['svgs']) == 9 and len(guard[1]['svgs']) == 10
assert all(canonical[0]['svgs'].get(name) == sha for cohort in guard for name, sha in cohort['svgs'].items())

report = {
    'versions': VERSIONS, 'commits': COMMITS, 'boards': boards,
    'cpuProfile': {'freshNativeRun': read('profile/report.json'), 'summary': read('profile/summary.json')},
    'fullBoardSummary': {'routingCompletedBefore': 0, 'routingCompletedAfter': 0, 'acceptedTracesBefore': 0, 'acceptedTracesAfter': 0, 'acceptedViasBefore': 0, 'acceptedViasAfter': 0, 'busPhasesStartedBefore': 0, 'busPhasesStartedAfter': 0},
    'isolatedNativeBoundaries': boundary,
    'isolatedNativePlanes': {'cases': plane_cases, 'acceptedBefore': plane_accepted, 'acceptedAfter': plane_accepted, 'allOutcomesAndAcceptedCopperIdentical': True, 'independentDrcIssues': 0},
    'pairedNativeSearches': paired,
    'fanout31': {'cases': 72, 'allPreparedBusFieldsIdenticalBaselineToFinal': True, 'completedSvgHashesMatchCanonicalBaseline': True, 'canonicalBaseline': {'solved': 30, 'timedOut': 42}, 'boundaryTimedComparison': {'beforeSolved': 9, 'afterSolved': 10, 'beforeTimedOut': 63, 'afterTimedOut': 62}, 'interpretation': 'The change affects none of the 72 frozen routing preparations. These workers hit different 120-second deadlines, including losses and gains, even between identical baseline versions. Their 9 → 10 counts do not establish a routing gain. All completed SVGs match the canonical baseline; raw reports retain every timeout.'},
    'sourceQualification': {'prototype': COMMITS['measuredFix'], 'final': COMMITS['fix'], 'preparedBusFieldsIdenticalForAll72FrozenAnd6NativeInputs': True, 'finalFormattingFullTypecheckAnd23FocusedAssertionsPass': True, 'finalSourceWorkflow': 'https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44525119825', 'frozenAuditWorkflow': 'https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44525124321'},
    'focused': {'beforeAccepted': 0, 'afterAccepted': 1, 'obstacles': 2038, 'afterVias': 0, 'afterIndependentDrcIssues': 0},
    'selectedFix': {'problem': 'Displacement from a source pad can select a direction different from the single boundary edge already touched by the target copper.', 'change': 'Use that unique common boundary edge as the default direction for ordinary boundary requests; preserve explicit directions, preferred exits, available regions and plane policy. Corners/interior/outside targets keep displacement inference.', 'existingEndpointPolicy': 'These are automatic breakout points: core already relocates them to each emitted boundary exit. The change does not force the original target coordinate.', 'decision': 'Choose the +12 net isolated accepts (+5.1%) and 15 fewer distinct drills over the CPU-only alternative. This is a net heuristic improvement, with one real OrangeCrab loss and no complete-board gain; no speedup claimed.', 'knownRegression': {'board': 'orangecrab', 'connection': 'breakout:pcb_breakout_point_5', 'before': 'down direction, solved with one via', 'after': 'right direction, failed', 'cause': 'Both existing rightward dogbone via sites intersect C4 bottom pads. The old down direction accesses the legal opposite interstice. The new default is a heuristic and does not improve every request.', 'evidence': ['focused/ddr2427-orange-boundary-loss.json', 'focused/ddr2427-orange-boundary-blockers.json']}},
    'alternativeCandidate': {'commit': '16e7eb622b9c47366e63f43f2ffada1c1c0c7f1a', 'change': 'Memoize immutable plane source paths and static string prefixes within each route call while retaining ordered clearance-cache lookups.', 'pairedNativeSearches': alternative_paired, 'fanout31': {'cases': 72, 'beforeSolved': 30, 'afterSolved': 30, 'identicalSolvedSvgs': 30}, 'decision': 'Deferred. It improves native medians by 26.8–29.8% with unchanged routes, but adds no accepted native request. The selected default-direction change improves routing yield and reduces aggregate drills.'},
    'limits': ['All six full boards still fail their first fanout region. Fanout precedes bus lanes and the remaining router; no DDR bus phase starts.', 'Best partial escape counts are uncommitted search states, not connected full-board nets or committed PCB copper.', 'OrangeCrab reaches 27 → 19 assignments at the 600-second cutoff and H616 after reaches 227/256; these partial counts are not matched timing measurements.', 'Boundary totals route one request at a time with complete original obstacles. Shared routing competition can change gains and via counts: joint U22 uses 7 → 8 vias while its best partial improves 7 → 9 escapes.', 'Three serial matched pairs per native scene alternate before/after order on one Blacksmith worker. Selected-candidate native medians rise about 3.1% / 0.1%, so no runtime improvement is claimed.', 'Original copper is removed; native source geometry and design rules are retained.']
}
(ROOT / 'analysis.json').write_text(json.dumps(report, indent=2) + '\n')

runs = {'publishedBaselineAndFreshProfile': 44519377875, 'earlyProfileOnIdenticalInput': 44519639464, 'cpuAlternative': 44521178962, 'boundaryCandidate': 44521254762, 'isolatedBoundaries': 44521938110, 'finalSourceChecks': 44525119825, 'frozenPreparedPolicyAudit': 44525124321, 'acceptedCopperAudit': 44526903608}
provenance = {'frozenAt': '2026-11-19', 'versions': VERSIONS, 'commits': COMMITS, 'controllerCommit': '1f9b63bd6cbb3da71cca147fbfd55b585b2a8dfe', 'workflowRuns': {name: f'https://github.com/tscircuit/tscircuit-autorouter/actions/runs/{run}' for name, run in runs.items()}, 'reproPr': 'https://github.com/tscircuit/fanout-solver/pull/321', 'fixPr': 'https://github.com/tscircuit/fanout-solver/pull/322', 'sourceNote': 'Full-board and boundary/plane replay measurements use the immutable prototype commit. CI verifies every PreparedBus field against the cleaned final source for all six native and all 72 frozen inputs. The rest of routing code is unchanged.', 'frozenDataset': {'repository': 'https://github.com/tscircuit/dataset-fanout31-am62l', 'commit': '8eabec2516c5066d43ec7672511a1134430c5d45', 'captureRun': 44415945774}}
(ROOT / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')

ns = '{http://www.w3.org/2000/svg}'
ET.register_namespace('', 'http://www.w3.org/2000/svg')
svg = ET.Element(ns + 'svg', {'width': '2000', 'height': '4930', 'viewBox': '0 0 2000 4930'})
ET.SubElement(svg, ns + 'rect', {'width': '2000', 'height': '4930', 'fill': 'white'})
def text(parent, x, y, content, size=18):
    ET.SubElement(parent, ns + 'text', {'x': str(x), 'y': str(y), 'font-size': str(size), 'font-family': 'sans-serif', 'fill': '#172033'}).text = content
text(svg, 20, 32, 'Six full boards — tscircuit 0.0.3245 / core 0.0.2427 / fanout 0.0.91', 25)
text(svg, 20, 65, 'Fresh routing: fanout → bus lanes → rest. 0/6 complete; 0 accepted traces/vias; DDR bus routing not reached.')
for index, row in enumerate(boards):
    for column, phase in enumerate(['baseline', 'candidate']):
        x, y = 20 + column * 1000, 95 + index * 800
        result = row['before' if column == 0 else 'after']
        text(svg, x, y + 25, row['title'] + (' — Before' if column == 0 else ' — After'), 19)
        text(svg, x, y + 53, f"Fanout incomplete; best partial {result['bestPartialConnections']}/{result['requestedConnections']} (uncommitted); 0 accepted traces/vias", 15)
        native = ET.parse(ROOT / 'pcb' / phase / (row['board'] + '.svg')).getroot()
        native.set('viewBox', f"0 0 {native.attrib['width']} {native.attrib['height']}")
        native.set('x', str(x)); native.set('y', str(y + 65)); native.set('width', '960'); native.set('height', '715')
        prefix = row['board'] + '-' + phase + '-'
        identifiers = {element.attrib['id']: prefix + element.attrib['id'] for element in native.iter() if 'id' in element.attrib}
        for element in native.iter():
            for key, content in list(element.attrib.items()):
                if key == 'id':
                    element.set(key, identifiers[content])
                else:
                    content = re.sub(r'url\(#([^)]+)\)', lambda match: 'url(#' + identifiers.get(match.group(1), match.group(1)) + ')', content)
                    if content.startswith('#') and content[1:] in identifiers:
                        content = '#' + identifiers[content[1:]]
                    element.set(key, content)
        svg.append(native)
ET.ElementTree(svg).write(ROOT / 'all-boards.svg', encoding='unicode')
page = ['<!doctype html><meta charset="utf-8"><title>DDR full-board rerun2427</title><style>body{font:16px system-ui;max-width:1500px;margin:auto;padding:24px}img{max-width:100%}table{border-collapse:collapse}td,th{padding:8px;border:1px solid #ddd}</style>', '<h1>Latest full-board rerun</h1>', '<p>tscircuit 0.0.3245 / core 0.0.2427 / fanout 0.0.91. All six boards still fail fanout; no accepted traces or vias and no DDR bus phase.</p>', '<p><a href="analysis.json">Analysis and raw statistics</a> · <a href="all-boards.svg">Full before/after PCB SVG</a> · <a href="circuits-and-results.zip">TSX sources and raw results</a></p>', '<p>The selected boundary-contact default increases isolated accepts 235 → 247 (+5.1%, 78.3% → 82.3%) and reduces aggregate distinct via drills 180 → 165 (−8.3%). There are 13 gains and one real OrangeCrab regression: rightward dogbone sites collide with C4 bottom pads. The old down direction finds a legal interstice.</p>', '<table><tr><th>Full board: uncommitted first-region partial</th><th>Before</th><th>After</th><th>Committed traces/vias</th></tr>']
for row in boards:
    page.append(f"<tr><td>{html.escape(row['title'])}</td><td>{row['before']['bestPartialConnections']}/{row['before']['requestedConnections']}</td><td>{row['after']['bestPartialConnections']}/{row['after']['requestedConnections']}</td><td>0 / 0</td></tr>")
page.extend(['</table>', '<h2>Actual joint U22 search</h2><p>Uncommitted partial 7 → 9 escapes, 7 → 8 vias, zero independent DRC issues. Neither 32-connection region completes. This separate joint result is not the isolated 300-request total.</p><table><tr><th>Before</th><th>After</th></tr><tr><td><img src="paired/icepi/before.svg"></td><td><img src="paired/icepi/after.svg"></td></tr></table>', '<h2>Focused native boundary contact</h2><p>The same snapshot test has all 2,038 original obstacles: 0/1 → 1/1 accepted, zero vias and DRC issues. Core relocates automatic breakout endpoints to the emitted boundary exit.</p><table><tr><th>Before</th><th>After</th></tr><tr><td><img src="focused/before.svg"></td><td><img src="focused/after.svg"></td></tr></table>', '<h2>Qualification and tradeoffs</h2><p>All 349 isolated plane outcomes/copper remain identical. All 72 frozen PreparedBus records are unchanged; raw deadline-limited 9 → 10 completions do not establish a policy gain. Every completed SVG matches the canonical baseline. The CPU alternative reduced matched native medians by 26.8–29.8% without additional escapes; it is deferred in favor of routing yield. No speedup is claimed for the selected fix.</p>', '<h2>All emitted full-board PCBs</h2><img src="all-boards.svg">'])
(ROOT / 'index.html').write_text('\n'.join(page))
print(json.dumps({'boundaryAccepted': [235,247], 'distinctDrills': drills, 'planeCasesUnchanged': plane_cases, 'all72FrozenPreparationsIdentical': True, 'fullBoardsComplete': [0,0], 'nativePartials': {row['board']: [row['before']['bestPartialConnections'], row['after']['bestPartialConnections']] for row in boards}}, indent=2))

