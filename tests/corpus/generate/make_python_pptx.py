"""
Decks made with python-pptx, for what the hand-written ones cannot be: a master, layouts and a theme that
Microsoft's own PowerPoint made. python-pptx ships `default.pptx`, PowerPoint's 2007 template (eleven
layouts, the Office theme, 4:3), and writes charts, tables, groups and notes in the XML PowerPoint reads. The
expectations are python-pptx's own reading of what it wrote, including the places it inherits for placeholders,
so the reader is held to an implementation that is not ours.

    /path/to/python -I make_python_pptx.py

writes `31-python-pptx-*.pptx` and `.expect.json` into `../pptx/`. Pillow draws the pictures. Nothing is downloaded.
"""

import io
import json
import os

from PIL import Image
from pptx import Presentation
from pptx.chart.data import BubbleChartData, CategoryChartData, XyChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE
from pptx.enum.dml import MSO_THEME_COLOR
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE, MSO_SHAPE_TYPE, PP_PLACEHOLDER
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Emu, Inches, Pt

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pptx")

PH = {
    PP_PLACEHOLDER.TITLE: "title",
    PP_PLACEHOLDER.CENTER_TITLE: "ctrTitle",
    PP_PLACEHOLDER.SUBTITLE: "subTitle",
    PP_PLACEHOLDER.BODY: "body",
    PP_PLACEHOLDER.OBJECT: "body",
    PP_PLACEHOLDER.PICTURE: "pic",
    PP_PLACEHOLDER.DATE: "dt",
    PP_PLACEHOLDER.FOOTER: "ftr",
    PP_PLACEHOLDER.SLIDE_NUMBER: "sldNum",
}

CHART = {
    XL_CHART_TYPE.COLUMN_CLUSTERED: "column",
    XL_CHART_TYPE.COLUMN_STACKED: "column",
    XL_CHART_TYPE.BAR_CLUSTERED: "bar",
    XL_CHART_TYPE.LINE: "line",
    XL_CHART_TYPE.LINE_MARKERS: "line",
    XL_CHART_TYPE.PIE: "pie",
    XL_CHART_TYPE.DOUGHNUT: "pie",
    XL_CHART_TYPE.AREA: "line",
    XL_CHART_TYPE.XY_SCATTER: "scatter",
    XL_CHART_TYPE.BUBBLE: "scatter",
}


def picture(w, h, a, b):
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = (x / max(1, w - 1) + y / max(1, h - 1)) / 2
            px[x, y] = tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))
    out = io.BytesIO()
    img.save(out, "PNG")
    out.seek(0)
    return out


def text_of(shape):
    if not shape.has_text_frame:
        return None
    t = shape.text_frame.text.replace("\x0b", "\n")
    return t if t.strip() else None


def describe(shape, k):
    """One element, as the reader should find it, in px on a deck 1920 wide."""
    box = [round(v * k, 2) for v in (shape.left, shape.top, shape.width, shape.height)]
    t = shape.shape_type
    if shape.is_placeholder and shape.has_text_frame:
        return {"kind": "shape", "ph": PH[shape.placeholder_format.type], "box": box, "text": text_of(shape)}
    if t == MSO_SHAPE_TYPE.PICTURE:
        return {"kind": "image", "box": box, "text": None}
    if t == MSO_SHAPE_TYPE.TABLE:
        texts = [c.text for r in shape.table.rows for c in r.cells if not c.is_spanned and c.text.strip()]
        return {"kind": "table", "box": box, "text": "\n".join(texts) or None, "rows": len(shape.table.rows), "cols": len(shape.table.columns), "tableTexts": texts}
    if t == MSO_SHAPE_TYPE.CHART:
        return {"kind": "chart", "box": box, "text": None}
    if t == MSO_SHAPE_TYPE.GROUP:
        kids = [describe(c, k) for c in shape.shapes]
        return {"kind": "group", "box": box, "text": "\n".join(c["text"] for c in kids if c.get("text")) or None, "children": kids}
    if t == MSO_SHAPE_TYPE.LINE:
        return {"kind": "line", "box": box, "text": None}
    return {"kind": "shape", "box": box, "text": text_of(shape)}


def expectations(prs, name, warnings=None):
    k = 1920 / prs.slide_width
    ratio = prs.slide_width / prs.slide_height
    size = "16:9" if ratio > 1.7 else "16:10" if ratio > 1.5 else "4:3"
    charts = []
    elements = []
    for slide in prs.slides:
        els = []
        for shape in slide.shapes:
            els.append(describe(shape, k))
            if shape.shape_type == MSO_SHAPE_TYPE.CHART:
                chart = shape.chart
                plot = chart.plots[0]
                charts.append(
                    {
                        "chart": CHART[chart.chart_type],
                        "categories": [str(c) for c in plot.categories] if chart.chart_type not in (XL_CHART_TYPE.XY_SCATTER, XL_CHART_TYPE.BUBBLE) else [],
                        "series": [{"name": s.name, "values": [float(v) for v in s.values]} for s in plot.series],
                        "title": chart.chart_title.text_frame.text if chart.has_title else None,
                    }
                )
        elements.append(els)
    return {
        "dialect": "python-pptx",
        "size": size,
        "slides": len(prs.slides),
        "layouts": [l.name for l in prs.slide_layouts],
        "slideLayouts": [s.slide_layout.name for s in prs.slides],
        "hidden": [s._element.get("show") == "0" for s in prs.slides],
        "notes": [s.notes_slide.notes_text_frame.text if s.has_notes_slide else None for s in prs.slides],
        "transitions": [None for _ in prs.slides],
        "elements": elements,
        "charts": charts,
        "warnings": warnings or [],
    }


def save(prs, name, warnings=None):
    prs.save(os.path.join(OUT, name + ".pptx"))
    with open(os.path.join(OUT, name + ".expect.json"), "w") as f:
        json.dump(expectations(prs, name, warnings), f, indent=1)
    print("wrote", name)


def layout(prs, name):
    return next(l for l in prs.slide_layouts if l.name == name)


# ── 31: the default template, 4:3, a bit of everything ───────────────────────────────────────
prs = Presentation()
s = prs.slides.add_slide(layout(prs, "Title Slide"))
s.shapes.title.text = "A real template"
s.placeholders[1].text = "PowerPoint's own master, through python-pptx"

s = prs.slides.add_slide(layout(prs, "Title and Content"))
s.shapes.title.text = "Levels and runs"
tf = s.placeholders[1].text_frame
tf.text = "First level"
for text, level in (("Second level", 1), ("Third level", 2), ("Back to the first", 0)):
    p = tf.add_paragraph()
    p.text = text
    p.level = level
p = tf.add_paragraph()
r = p.add_run()
r.text = "Bold, red and linked"
r.font.bold = True
r.font.color.rgb = RGBColor(0xC0, 0x00, 0x00)
r.hyperlink.address = "https://example.com/office"

s = prs.slides.add_slide(layout(prs, "Two Content"))
s.shapes.title.text = "Two columns"
s.placeholders[1].text = "Left column"
s.placeholders[2].text = "Right column"
s.shapes.add_picture(picture(160, 90, (30, 80, 200), (120, 200, 255)), Inches(1), Inches(5.2), Inches(2), Inches(1.1))

s = prs.slides.add_slide(layout(prs, "Title Only"))
s.shapes.title.text = "Tables and shapes"
tbl = s.shapes.add_table(3, 3, Inches(0.7), Inches(1.8), Inches(5), Inches(1.5)).table
tbl.cell(0, 0).merge(tbl.cell(0, 1))
tbl.cell(0, 0).text = "Merged header"
tbl.cell(0, 2).text = "C"
for r_ in (1, 2):
    for c_ in range(3):
        tbl.cell(r_, c_).text = f"r{r_}c{c_}"
tbl.cell(1, 0).merge(tbl.cell(2, 0))
box = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(6), Inches(2), Inches(2.5), Inches(1))
box.fill.solid()
box.fill.fore_color.theme_color = MSO_THEME_COLOR.ACCENT_2
box.fill.fore_color.brightness = 0.4
box.text_frame.text = "Accent 2, lighter 40%"
box.text_frame.paragraphs[0].alignment = PP_ALIGN.CENTER
oval = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(6), Inches(3.6), Inches(1.5), Inches(1.5))
oval.fill.solid()
oval.fill.fore_color.rgb = RGBColor(0x70, 0xAD, 0x47)
oval.line.color.theme_color = MSO_THEME_COLOR.ACCENT_1
oval.line.width = Pt(3)
arrow = s.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, Inches(0.7), Inches(4.2), Inches(2), Inches(0.8))
arrow.rotation = 15

s = prs.slides.add_slide(layout(prs, "Blank"))
grp = s.shapes.add_group_shape()
a = grp.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(1), Inches(1), Inches(2), Inches(1))
a.text_frame.text = "In a group"
b = grp.shapes.add_shape(MSO_SHAPE.OVAL, Inches(3), Inches(2), Inches(1), Inches(1))
tb = s.shapes.add_textbox(Inches(1), Inches(4), Inches(4), Inches(0.8))
tb.text_frame.text = "A text box"
tb.text_frame.vertical_anchor = MSO_ANCHOR.MIDDLE
s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(5), Inches(1), Inches(8), Inches(3))
s.notes_slide.notes_text_frame.text = "Notes that PowerPoint's template gives a home."

s = prs.slides.add_slide(layout(prs, "Section Header"))
s.shapes.title.text = "Section"
s.placeholders[1].text = "Introduces a part"
s = prs.slides.add_slide(layout(prs, "Comparison"))
s.shapes.title.text = "Comparison"
s.placeholders[1].text = "Left heading"
s.placeholders[2].text = "Left text"
s.placeholders[3].text = "Right heading"
s.placeholders[4].text = "Right text"
s = prs.slides.add_slide(layout(prs, "Content with Caption"))
s.shapes.title.text = "Caption"
s.placeholders[2].text = "The caption's words"
save(prs, "31-python-pptx-default")

# ── 32: the same template at 16:9, as someone who only changes the slide size has it ─────────────
prs = Presentation()
prs.slide_width = Emu(12192000)
prs.slide_height = Emu(6858000)
s = prs.slides.add_slide(layout(prs, "Title and Content"))
s.shapes.title.text = "Widescreen, layouts left as they were"
s.placeholders[1].text = "The layouts keep their 4:3 places"
s.shapes.add_picture(picture(48, 48, (200, 40, 120), (255, 180, 220)), Inches(10), Inches(5), Inches(1.2), Inches(1.2))
save(prs, "32-python-pptx-widescreen")

# ── 33: charts, as python-pptx writes them (PowerPoint's chart XML, with its workbook) ─────────
prs = Presentation()
s = prs.slides.add_slide(layout(prs, "Title Only"))
s.shapes.title.text = "Charts"
cd = CategoryChartData()
cd.categories = ["East", "West", "North"]
cd.add_series("2025", (19.2, 21.4, 16.7))
cd.add_series("2026", (22.3, 28.6, 15.2))
s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(0.5), Inches(1.6), Inches(4.4), Inches(3.5), cd)
s.shapes.add_chart(XL_CHART_TYPE.BAR_CLUSTERED, Inches(5), Inches(1.6), Inches(4.4), Inches(3.5), cd)
s = prs.slides.add_slide(layout(prs, "Title Only"))
s.shapes.title.text = "Line and pie"
s.shapes.add_chart(XL_CHART_TYPE.LINE_MARKERS, Inches(0.5), Inches(1.6), Inches(4.4), Inches(3.5), cd)
pie = CategoryChartData()
pie.categories = ["A", "B", "C"]
pie.add_series("Share", (0.5, 0.3, 0.2))
gf = s.shapes.add_chart(XL_CHART_TYPE.PIE, Inches(5), Inches(1.6), Inches(4.4), Inches(3.5), pie)
gf.chart.has_title = True
gf.chart.chart_title.text_frame.text = "Share of the whole"
s = prs.slides.add_slide(layout(prs, "Title Only"))
s.shapes.title.text = "Scatter, area, doughnut, stacked, bubble"
xy = XyChartData()
ser = xy.add_series("Series 1")
for x, y in ((1, 2), (2, 4), (3, 3.5), (4, 8)):
    ser.add_data_point(x, y)
s.shapes.add_chart(XL_CHART_TYPE.XY_SCATTER, Inches(0.2), Inches(1.6), Inches(3), Inches(2.5), xy)
s.shapes.add_chart(XL_CHART_TYPE.AREA, Inches(3.3), Inches(1.6), Inches(3), Inches(2.5), cd)
s.shapes.add_chart(XL_CHART_TYPE.DOUGHNUT, Inches(6.4), Inches(1.6), Inches(3), Inches(2.5), pie)
s.shapes.add_chart(XL_CHART_TYPE.COLUMN_STACKED, Inches(0.2), Inches(4.2), Inches(3), Inches(2.5), cd)
bub = BubbleChartData()
bs = bub.add_series("Bubbles")
bs.add_data_point(1, 2, 5)
bs.add_data_point(3, 4, 9)
s.shapes.add_chart(XL_CHART_TYPE.BUBBLE, Inches(3.3), Inches(4.2), Inches(3), Inches(2.5), bub)
save(prs, "33-python-pptx-charts", ["area chart is drawn as a line chart", "doughnut chart is drawn as a pie chart", "stacked chart is drawn side by side", "bubble chart is drawn as a scatter chart"])
