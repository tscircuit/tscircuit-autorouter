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
VERSIONS = {'tscircuit': '0.0.3244', 'core': '0.0.2426', 'fanout': '0.0.90', 'capacityAutorouter': '0.0.1133', 'busLanes': '0.0.62', 'bun': '1.4.3'}
COMMITS = {
    'tscircuit': '0060ee57190e0bf7103d59044c91f527734e381d',
    'core': '7614f02af40163da1dc2934d2ec5fa4665ae697e',
    'capacityAutorouter': 'a4f2778cb40bbc9c147b95a4e48ef0b32f1dd08f',
    'fanoutBaseline': 'e6fe9d6fbf52e9239d3d3db8626876e082518bbf',
    'measuredFix': '8efcf81fa69a3c5368c451f74447b16750ea1b16',
    'repro': 'ec4aebf6223827a681aaebd908e903396b774777',
    'fix': '3ddf9d1a7c8fd863eab9af5af4ba308956ab365c',
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
    boards.append({'board': board, 'title': title, 'before': before, 'after': after})

paired = {}
for board in ['icepi', 'imx6']:
    rows = read(f'paired/{board}/comparison.json')
    assert len(rows) == 6 and len({row['inputSha256'] for row in rows}) == len({row['copperSha256'] for row in rows}) == 1
    assert rows[0]['inputSha256'] == next(row['before']['inputSha256'] for row in boards if row['board'] == board)
    assert all(row['copperDrc']['valid'] and not row['copperDrc']['issues'] and row['copperDrc']['checkedViaCount'] == 7 and row['iterations'] == 26131 and row['failed'] and not row['solved'] for row in rows)
    before = [row['elapsedMs'] for row in rows if row['revision'] == 'before']
    after = [row['elapsedMs'] for row in rows if row['revision'] == 'after']
    before_median, after_median = statistics.median(before), statistics.median(after)
    before_p95, after_p95 = quantile(before, .95), quantile(after, .95)
    assert after_median < before_median and after_p95 < before_p95 and statistics.mean(after) < statistics.mean(before)
    paired[board] = {'beforeMs': before, 'afterMs': after, 'beforeMedianMs': before_median, 'afterMedianMs': after_median, 'medianReductionPercent': 100 * (1 - after_median / before_median), 'beforeP95Ms': before_p95, 'afterP95Ms': after_p95, 'p95ReductionPercent': 100 * (1 - after_p95 / before_p95), 'beforeMeanMs': statistics.mean(before), 'afterMeanMs': statistics.mean(after), 'inputSha256': rows[0]['inputSha256'], 'copperSha256': rows[0]['copperSha256'], 'throughVias': 7, 'independentDrcIssues': 0, 'iterations': 26131, 'partialEscapes': rows[0]['bestPartial']['routed'], 'requestedConnections': 32, 'fullSolve': False}

matched = read('performance/fanout31-matched.json')
original = next(row for row in matched if row['cohort'] == 'matched/original')
fixed = next(row for row in matched if row['cohort'] == 'matched/cleanup')
assert original['report']['commit'] == COMMITS['fanoutBaseline'] and fixed['report']['commit'] == COMMITS['measuredFix']
assert original['svgs'] == fixed['svgs'] and len(original['svgs']) == 30
keys = ['sample', 'status', 'connections', 'routed', 'vias', 'validatedBreakouts']
assert len(original['report']['rows']) == len(fixed['report']['rows']) == 72
assert [{key: row.get(key) for key in keys} for row in original['report']['rows']] == [{key: row.get(key) for key in keys} for row in fixed['report']['rows']]
guard_times = {}
for label, cohort in [('before', original), ('after', fixed)]:
    elapsed = [row['milliseconds'] for row in cohort['report']['rows'] if row['status'] == 'solved']
    guard_times[label] = {'solvedMeanMs': statistics.mean(elapsed), 'solvedP50Ms': quantile(elapsed, .5), 'solvedP95Ms': quantile(elapsed, .95)}
cases = accepted = 0
for board in BOARDS:
    pair = read(f'isolated/{board}.json')
    before = next(row['rows'] for row in pair if row['revision'] == 'before')
    after = next(row['rows'] for row in pair if row['revision'] == 'after')
    assert len(before) == len(after)
    for first, second in zip(before, after):
        for key in ['busId', 'inputSha256', 'status', 'copperSha256']:
            assert first[key] == second[key], (board, key)
        cases += 1
        if second['status'] == 'solved':
            accepted += 1
            assert second['copperDrc']['valid'] and not second['copperDrc']['issues']
assert cases == 349 and accepted == 292

report = {
    'versions': VERSIONS, 'commits': COMMITS, 'boards': boards, 'pairedNativeSearches': paired,
    'fanout31': {'cases': 72, 'solvedBefore': 30, 'solvedAfter': 30, 'timedOutBefore': 42, 'timedOutAfter': 42, 'identicalSolvedSvgs': 30, 'allOutcomesIdentical': True, 'singlePassGuardTimings': guard_times},
    'isolatedNativePlanes': {'cases': cases, 'acceptedBefore': accepted, 'acceptedAfter': accepted, 'allAcceptedCopperIdentical': True, 'independentDrcIssues': 0},
    'focused': {'exactSegmentObstacleChecksBefore': 306, 'exactSegmentObstacleChecksAfter': 3, 'reductionPercent': 100 * (1 - 3 / 306), 'sameRouteAndVia': True},
    'fullBoardSummary': {'routingCompletedBefore': sum(row['before']['routingCompleted'] for row in boards), 'routingCompletedAfter': sum(row['after']['routingCompleted'] for row in boards), 'acceptedTracesBefore': 0, 'acceptedTracesAfter': 0, 'acceptedViasBefore': 0, 'acceptedViasAfter': 0, 'busPhasesStartedBefore': 0, 'busPhasesStartedAfter': 0},
    'selectedFix': {'problem': 'Exact segment-obstacle checks run for geometrically distant obstacles.', 'change': 'Conservative axis bounds contain any rotation of rectangles and circles; retain exact decisions near copper.', 'scope': '17 production lines, one file; no new solver, cache or changed routing rules.', 'keepDecision': 'Keep for the roughly 19% median/P95 improvement in both matched native controls, with identical routes and all349/72 guard outcomes. The single unpaired Fanout31 pass has solved P95 0.6% higher while solved mean/P50 fall; this run is an outcome guard and does not establish an overall Fanout31 timing improvement.'},
    'cpuProfile': read('profile/summary.json'),
    'alternativeCandidate': {'commit': 'e89b61de61efa88e815d9af1cfb13e705c0f632d', 'problem': 'Candidate via-pour eligibility disagrees with final terminal-layer DRC.', 'isolatedQualification': read('quality/isolated-summary.json'), 'decision': 'Retained as a separate correctness prototype. One isolated native bus recovers, no full board completes, and native medians rise about 2–3%. Its single official run shows 30 → 31 solves, but the unchanged baseline itself flips two deadline-sensitive outcomes between workers. All 72 frozen inputs contain zero pours, so the changed eligibility policy cannot change their legal candidates; case 22 emits the same SVG as the unchanged baseline. This is not an established additional routing solve. The selected PR has repeatable roughly 19% native timing gains.', 'frozenInputAudit': read('quality/frozen-input-audit.json')},
    'limits': ['All six full boards still fail fanout; no DDR bus phase begins.', 'Partial escape counts are uncommitted search states, not completed nets.', 'OrangeCrab reaches 20 → 27 assignments at the 600-second cutoff, with the same 122/273 best partial; separate workers and deadlines do not provide a matched speed measurement.', 'Native timings are three serial matched pairs per scene, alternating order on the same worker; P95 uses linear interpolation over three runs.', '306 → 3 measures exact geometry calls for two accepted native segments, not a 99% whole solver speedup.', 'Baseline raw progress.runtime contains stale hardcoded tscircuit/core labels. Archived runtime-package.json, core-package.json and core-build.json verify the actual 0.0.3244 / 0.0.2426 / 0.0.90 stack for all six runs; the harness now derives those labels from the actual package/build records.'],
}
(ROOT / 'analysis.json').write_text(json.dumps(report, indent=2) + '\n')

ns = '{http://www.w3.org/2000/svg}'
ET.register_namespace('', 'http://www.w3.org/2000/svg')
svg = ET.Element(ns + 'svg', {'width': '2000', 'height': '4930', 'viewBox': '0 0 2000 4930'})
ET.SubElement(svg, ns + 'rect', {'width': '2000', 'height': '4930', 'fill': 'white'})
def text(parent, x, y, content, size=18):
    ET.SubElement(parent, ns + 'text', {'x': str(x), 'y': str(y), 'font-size': str(size), 'font-family': 'sans-serif', 'fill': '#172033'}).text = content
text(svg, 20, 32, 'Six full boards — tscircuit 0.0.3244 / core 0.0.2426 / fanout 0.0.90', 25)
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
page = ['<!doctype html><meta charset="utf-8"><title>DDR full-board rerun2426</title><style>body{font:16px system-ui;max-width:1500px;margin:auto;padding:24px}img{max-width:100%}table{border-collapse:collapse}td,th{padding:8px;border:1px solid #ddd}</style>', '<h1>Latest full-board rerun</h1>', '<p>tscircuit 0.0.3244 / core 0.0.2426 / fanout 0.0.90. All six boards still fail fanout; no accepted traces or vias and no DDR bus phase. The fix reduces exact obstacle work.</p>', '<p><a href="analysis.json">Analysis and raw statistics</a> · <a href="all-boards.svg">Full before/after PCB SVG</a> · <a href="circuits-and-results.zip">TSX sources and raw results</a></p>', '<table><tr><th>Native search</th><th>Before median</th><th>After median</th><th>Reduction</th></tr>']
for board, measurement in paired.items():
    page.append(f"<tr><td>{html.escape(BOARDS[board])}</td><td>{measurement['beforeMedianMs']/1000:.2f}s</td><td>{measurement['afterMedianMs']/1000:.2f}s</td><td>{measurement['medianReductionPercent']:.1f}%</td></tr>")
page.extend(['</table>', '<h2>Actual native U22 search</h2><p>Identical uncommitted copper; only measured timing labels change.</p><table><tr><td><img src="paired/icepi/before.svg"></td><td><img src="paired/icepi/after.svg"></td></tr></table>', '<h2>Focused exact geometry checks</h2><table><tr><td><img src="focused/before.svg"></td><td><img src="focused/after.svg"></td></tr></table>', '<h2>All boards</h2><img src="all-boards.svg">'])
(ROOT / 'index.html').write_text('\n'.join(page))
print(json.dumps({'native': paired, 'fanout31': report['fanout31'], 'fullBoards': report['fullBoardSummary']}, indent=2))
