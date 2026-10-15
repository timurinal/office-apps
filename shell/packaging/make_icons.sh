#!/bin/sh
# Office.icns from icon-1024.png (macOS: sips and iconutil). Run from anywhere.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
set_dir="$here/build/Office.iconset"
rm -rf "$set_dir" && mkdir -p "$set_dir"
for size in 16 32 128 256 512; do
  sips -z $size $size "$here/icon-1024.png" --out "$set_dir/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z $double $double "$here/icon-1024.png" --out "$set_dir/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$set_dir" -o "$here/build/Office.icns"
echo "$here/build/Office.icns"
