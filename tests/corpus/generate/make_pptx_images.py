"""
The pictures the pptx corpus uses, as base64 in pptx_images.mjs.

    /path/to/python -I make_pptx_images.py

Pillow draws each picture from scratch: a diagonal gradient with a block of a second colour in one
corner, so a crop that cuts the wrong side is visible in the bytes. Four formats the deck can hold,
and two it cannot (an SVG and an EMF header), which the corpus uses for the pictures that must be
left out. Nothing is downloaded.
"""

import base64
import io
import os
import struct

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))


def picture(w, h, a, b):
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = (x / max(1, w - 1) + y / max(1, h - 1)) / 2
            px[x, y] = tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w // 4, h // 4], fill=(255, 255, 255))
    return img


def encode(img, fmt, **kw):
    out = io.BytesIO()
    img.save(out, fmt, **kw)
    return base64.b64encode(out.getvalue()).decode()


def emf_header():
    # An EMF header: record type 1, size 88, then " EMF" at offset 40. Enough to be told apart from a picture.
    head = struct.pack("<II", 1, 88) + bytes(32) + struct.pack("<I", 0x464D4520) + bytes(44)
    return base64.b64encode(head).decode()


SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>'

images = {
    "PNG_BLUE": encode(picture(96, 54, (30, 80, 200), (120, 200, 255)), "PNG"),
    "PNG_TALL": encode(picture(40, 80, (200, 60, 30), (255, 200, 120)), "PNG"),
    "JPEG_GREEN": encode(picture(96, 54, (20, 120, 60), (180, 240, 120)), "JPEG", quality=70),
    "GIF_PINK": encode(picture(48, 48, (200, 40, 120), (255, 180, 220)), "GIF"),
    "WEBP_GREY": encode(picture(64, 36, (60, 60, 60), (200, 200, 200)), "WEBP", lossless=True),
    "EMF": emf_header(),
    "SVG": base64.b64encode(SVG.encode()).decode(),
}

with open(os.path.join(HERE, "pptx_images.mjs"), "w") as f:
    f.write("// Written by make_pptx_images.py. Pictures drawn for the pptx corpus; see that script.\n")
    for name, data in images.items():
        f.write(f"export const {name} = Uint8Array.from(atob('{data}'), (c) => c.charCodeAt(0));\n")
print("wrote pptx_images.mjs:", {k: len(v) for k, v in images.items()})
