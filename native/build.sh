#!/usr/bin/env bash
# Builds klick-capture as a universal (arm64 + x64) binary at
# out/native/klick-capture. electron-builder picks it up via extraResources.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/native/klick-capture/main.swift"
OUT_DIR="$ROOT/out/native"
OUT="$OUT_DIR/klick-capture"

mkdir -p "$OUT_DIR"

ARM64="$OUT_DIR/klick-capture-arm64"
X64="$OUT_DIR/klick-capture-x64"

# macos13.0 target: SCContentFilter(desktopIndependentWindow:) is 13+.
echo "[swift] building arm64..."
swiftc -O -target arm64-apple-macos13.0 "$SRC" -o "$ARM64"

echo "[swift] building x86_64..."
swiftc -O -target x86_64-apple-macos13.0 "$SRC" -o "$X64"

echo "[lipo] merging..."
lipo -create -output "$OUT" "$ARM64" "$X64"
rm -f "$ARM64" "$X64"

lipo -info "$OUT"
echo "[ok] $OUT"
