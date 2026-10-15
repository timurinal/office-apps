import os

from officeapps.kinds import KINDS, classify, open_filter
from officeapps.scheme import mime_of, resolve


def build(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<html>")
    (tmp_path / "assets" / "a.js").write_text("x")
    (tmp_path.parent / "secret.txt").write_text("no")
    return str(tmp_path)


def test_resolve(tmp_path):
    root = build(tmp_path)
    assert resolve(root, "/assets/a.js") == os.path.join(os.path.realpath(root), "assets", "a.js")
    assert resolve(root, "/") == os.path.join(root, "index.html")
    assert resolve(root, "/docs") == os.path.join(root, "index.html")
    assert resolve(root, "/sheets/") == os.path.join(root, "index.html")
    assert resolve(root, "/assets/missing.js") is None
    assert resolve(root, "/missing.png") is None
    assert resolve(root, "/api/office/me") is None
    assert resolve(root, "/../secret.txt") is None
    assert resolve(root, "/assets/../../secret.txt") is None


def test_mime():
    assert mime_of("x.js") == "text/javascript"
    assert mime_of("x.woff2") == "font/woff2"
    assert mime_of("x.svg") == "image/svg+xml"


def test_kinds():
    assert classify("/a/b.OADOC") == (KINDS["docs"], True)
    assert classify("report.docx") == (KINDS["docs"], False)
    assert classify("book.csv") == (KINDS["sheets"], False)
    assert classify("deck.pptx") is None
    assert classify("deck.oadeck") is None  # Slides is not built yet
    assert open_filter().startswith("Documents (*.oadoc")
