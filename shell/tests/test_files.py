import json
import os

from officeapps.files import BACKUPS_KEPT, Backups, Recents, safe_name, write_atomic


def test_write_atomic_replaces_and_keeps_mode(tmp_path):
    p = tmp_path / "a.oadoc"
    p.write_bytes(b"old")
    os.chmod(p, 0o640)
    write_atomic(str(p), b"new")
    assert p.read_bytes() == b"new"
    assert (os.stat(p).st_mode & 0o777) == 0o640
    assert [n for n in os.listdir(tmp_path) if n.startswith(".~")] == []


def test_write_atomic_leaves_the_old_file_when_the_write_fails(tmp_path, monkeypatch):
    p = tmp_path / "a.oadoc"
    p.write_bytes(b"old")

    def boom(*_a, **_k):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(os, "replace", boom)
    try:
        write_atomic(str(p), b"new")
    except OSError:
        pass
    assert p.read_bytes() == b"old"
    assert [n for n in os.listdir(tmp_path) if n.startswith(".~")] == []


def test_safe_name():
    assert safe_name("Q3 / plan: final?", "oadoc") == "Q3 plan final.oadoc"
    assert safe_name("   ", "oasheet") == "Untitled.oasheet"
    assert safe_name("..hidden", "oadoc") == "hidden.oadoc"


def test_backups_are_spaced_and_capped(tmp_path):
    doc = tmp_path / "d.oadoc"
    doc.write_bytes(b"v0")
    b = Backups(str(tmp_path / "Backups"))
    assert b.before_write(str(doc), now=1000) is not None
    assert b.before_write(str(doc), now=1100) is None  # under ten minutes
    for i in range(BACKUPS_KEPT + 5):
        b._last.clear()
        b.before_write(str(doc), now=2000 + i * 700)
    kept = [n for n in os.listdir(b.folder_for(str(doc))) if n != "source.txt"]
    assert len(kept) == BACKUPS_KEPT


def test_recents(tmp_path):
    f = tmp_path / "recents.json"
    r = Recents(str(f))
    a, b = tmp_path / "a.oadoc", tmp_path / "b.oasheet"
    a.write_bytes(b"x")
    r.add(str(a), "docs", now_ms=1)
    r.add(str(b), "sheets", now_ms=2)
    r.add(str(a), "docs", now_ms=3)
    assert [i.name for i in r.items] == ["a.oadoc", "b.oasheet"]
    assert str(a) in r and str(tmp_path / "c") not in r
    listing = {i["name"]: i["exists"] for i in r.listing()}
    assert listing == {"a.oadoc": True, "b.oasheet": False}
    r.replace(str(a), str(tmp_path / "renamed.oadoc"))
    assert Recents(str(f)).items[0].name == "renamed.oadoc"
    f.write_text("not json")
    assert Recents(str(f)).items == []
    f.write_text(json.dumps([{"path": 1}]))
    assert Recents(str(f)).items == []
