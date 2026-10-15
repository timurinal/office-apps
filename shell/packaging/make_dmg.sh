#!/bin/sh
# A disk image with the app and a link to /Applications. Usage: make_dmg.sh <Office.app> <out.dmg>
set -eu
app="$1"
out="$2"
stage=$(mktemp -d)
cp -R "$app" "$stage/"
ln -s /Applications "$stage/Applications"
rm -f "$out"
hdiutil create -volname "Office" -srcfolder "$stage" -ov -format UDZO "$out"
rm -rf "$stage"
echo "$out"
