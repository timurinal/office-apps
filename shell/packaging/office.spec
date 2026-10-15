# PyInstaller spec for the macOS app: `pyinstaller --noconfirm shell/packaging/office.spec` from the
# repository root, after `npm run build` and `sh shell/packaging/make_icons.sh`.
import json
import os

HERE = os.path.abspath(SPECPATH)
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SHELL = os.path.join(ROOT, "shell")

version = {}
with open(os.path.join(SHELL, "officeapps", "__init__.py"), encoding="utf-8") as f:
    exec(f.read(), version)
VERSION = version["__version__"]
APP = version["APP_NAME"]
BUNDLE_ID = version["BUNDLE_ID"]

with open(os.path.join(SHELL, "officeapps", "kinds.json"), encoding="utf-8") as f:
    KINDS = json.load(f)

# Finder: the app's own files it owns; the files it imports it offers to open, without taking them over.
IMPORTED_UTIS = {
    "docx": "org.openxmlformats.wordprocessingml.document",
    "md": "net.daringfireball.markdown",
    "markdown": "net.daringfireball.markdown",
    "html": "public.html",
    "htm": "public.html",
    "txt": "public.plain-text",
    "xlsx": "org.openxmlformats.spreadsheetml.sheet",
    "csv": "public.comma-separated-values-text",
    "tsv": "public.tab-separated-values-text",
}
exported, documents = [], []
for kind, k in KINDS.items():
    if not k["enabled"]:
        continue
    uti = f"{BUNDLE_ID}.{k['noun']}"
    exported.append({
        "UTTypeIdentifier": uti,
        "UTTypeDescription": f"{APP} {k['noun']}",
        "UTTypeConformsTo": ["public.data", "public.content"],
        "UTTypeIconFile": "Office.icns",
        "UTTypeTagSpecification": {"public.filename-extension": [k["extension"]], "public.mime-type": [k["mime"]]},
    })
    documents.append({
        "CFBundleTypeName": f"{APP} {k['noun']}",
        "CFBundleTypeRole": "Editor",
        "LSHandlerRank": "Owner",
        "LSItemContentTypes": [uti],
        "CFBundleTypeIconFile": "Office.icns",
    })
    utis = sorted({IMPORTED_UTIS[e] for e in k["imports"] if e in IMPORTED_UTIS})
    if utis:
        documents.append({
            "CFBundleTypeName": f"Files {APP} {k['label']} opens",
            "CFBundleTypeRole": "Viewer",
            "LSHandlerRank": "Alternate",
            "LSItemContentTypes": utis,
        })

a = Analysis(
    [os.path.join(HERE, "launch.py")],
    pathex=[SHELL],
    datas=[
        (os.path.join(ROOT, "dist", "web"), "web"),
        (os.path.join(SHELL, "officeapps", "kinds.json"), "officeapps"),
        (os.path.join(ROOT, "LICENSES"), "LICENSES"),
    ],
    hiddenimports=[
        "PySide6.QtWebEngineCore",
        "PySide6.QtWebEngineWidgets",
        "PySide6.QtWebChannel",
        "PySide6.QtPrintSupport",
        "PySide6.QtTest",
    ],
    excludes=["tkinter", "unittest", "pydoc", "PySide6.QtQuick3D", "PySide6.Qt3DCore", "PySide6.QtMultimedia", "PySide6.QtCharts", "PySide6.QtDataVisualization", "PySide6.QtGraphs", "PySide6.QtBluetooth", "PySide6.QtSerialPort", "PySide6.QtSql", "PySide6.QtDesigner"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name=APP,
    console=False,
    # Qt takes Finder's open-document events itself (QFileOpenEvent); PyInstaller must not eat them first.
    argv_emulation=False,
    target_arch=os.environ.get("OFFICE_ARCH", "arm64"),
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(exe, a.binaries, a.datas, name=APP)
app = BUNDLE(
    coll,
    name=f"{APP}.app",
    icon=os.path.join(HERE, "build", "Office.icns"),
    bundle_identifier=BUNDLE_ID,
    version=VERSION,
    info_plist={
        "CFBundleName": APP,
        "CFBundleDisplayName": APP,
        "CFBundleShortVersionString": VERSION,
        "CFBundleVersion": VERSION,
        "LSMinimumSystemVersion": os.environ.get("OFFICE_MIN_MACOS", "13.0"),
        "LSApplicationCategoryType": "public.app-category.productivity",
        "NSHighResolutionCapable": True,
        "NSSupportsAutomaticGraphicsSwitching": True,
        "NSRequiresAquaSystemAppearance": False,
        "UTExportedTypeDeclarations": exported,
        "CFBundleDocumentTypes": documents,
    },
)
