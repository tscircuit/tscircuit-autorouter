"""Crop a native solver SVG without changing any routed geometry."""

import gzip
import hashlib
import json
import colorsys
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET

board, source_name, output_name = sys.argv[1:]
source = Path(source_name)
svg = source.read_text()
namespace = "{http://www.w3.org/2000/svg}"
samples = []
for line in ET.fromstring(svg).iter(namespace + "polyline"):
    world = line.get("data-points")
    screen = line.get("points")
    if not world or not screen:
        continue
    original_points = [tuple(map(float, point.split(","))) for point in world.split()]
    rendered_points = [tuple(map(float, point.split(","))) for point in screen.split()]
    samples.extend(zip(original_points, rendered_points))


def axis_transform(axis):
    first_world, first_screen = samples[0]
    for world, screen in samples[1:]:
        difference = world[axis] - first_world[axis]
        if abs(difference) > 1e-6:
            scale = (screen[axis] - first_screen[axis]) / difference
            offset = first_screen[axis] - first_world[axis] * scale
            for observed, rendered in samples:
                assert abs(observed[axis] * scale + offset - rendered[axis]) < 1e-5
            return scale, offset
    raise RuntimeError("Native SVG has no usable coordinate transform")


input_path = Path("/workspace/ddr-rerun-2427/baseline/boards") / board / "fanout-1-input.json.gz"
capture = json.loads(gzip.decompress(input_path.read_bytes()))
bounds = capture["solverOptions"]["sharedBoundary"]
extent = max(bounds["maxX"] - bounds["minX"], bounds["maxY"] - bounds["minY"]) + 2.2
center_x = (bounds["maxX"] + bounds["minX"]) / 2
center_y = (bounds["maxY"] + bounds["minY"]) / 2
scale_x, offset_x = axis_transform(0)
scale_y, offset_y = axis_transform(1)
left = (center_x - extent / 2) * scale_x + offset_x
top = (center_y + extent / 2) * scale_y + offset_y
width = extent * scale_x
height = -extent * scale_y
assert width > 0 and height > 0
root = f'<svg width="900" height="900" viewBox="{left} {top} {width} {height}" xmlns="http://www.w3.org/2000/svg">'
cropped = re.sub(r"^<svg[^>]*>", root, svg, count=1)
cropped = cropped.replace(
    '<rect width="100%" height="100%" fill="white"/>',
    f'<rect x="{left}" y="{top}" width="{width}" height="{height}" fill="white"/>',
    1,
)


def style_debug_point(match):
    point = match.group(0)
    point = re.sub(r'\br="[^"]*"', f'r="{2 * width / 900}"', point)
    color = re.search(r'fill="hsl\(([^,]+),\s*([^%]+)%,\s*([^%]+)%\)"', point)
    if color:
        hue, saturation, lightness = map(float, color.groups())
        rgb = colorsys.hls_to_rgb(hue / 360, lightness / 100, saturation / 100)
        hexadecimal = "#" + "".join(f"{round(channel * 255):02x}" for channel in rgb)
        point = point.replace(color.group(0), f'fill="{hexadecimal}"')
    return point


# Point glyphs are screen-size debug markers; blue data-type=circle vias keep
# their original physical radii. Hex colors preserve fractional HSL hues in
# renderers that otherwise display them as black.
cropped = re.sub(r'<circle\b[^>]*data-type="point"[^>]*/>', style_debug_point, cropped)
original_shapes = [element.attrib for element in ET.fromstring(svg).iter()
                   if element.get("data-type") and element.get("data-type") != "point"]
cropped_shapes = [element.attrib for element in ET.fromstring(cropped).iter()
                  if element.get("data-type") and element.get("data-type") != "point"]
assert original_shapes == cropped_shapes
output = Path(output_name)
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text("\n".join(line.rstrip() for line in cropped.splitlines()) + "\n")
output.with_suffix(".crop.json").write_text(json.dumps({
    "sourceSvgSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    "inputSha256": hashlib.sha256(gzip.decompress(input_path.read_bytes())).hexdigest(),
    "sharedBoundary": bounds,
    "worldExtentMm": extent,
    "operation": "Crop viewport and white background; debug points keep2px display radii and equivalent portable hex colors. All copper/via/obstacle elements retained byte-for-byte.",
}, indent=2) + "\n")
