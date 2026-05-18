# Klick

Open-source screen demo editor with cursor-aware zoom. macOS 13+ for now.

## What it does

- ScreenCaptureKit recording — OS cursor's excluded, I draw my own on top
- Zoom segments (follow-cursor or fixed) plus an optional global zoom
- Click animations (ring, pulse, halo) and a custom cursor (arrow or dot)
- Background frame with color, padding, corner radius
- Aspect ratios: native, 16:9, 9:16, 1:1, 4:5
- Trim, cut, speed ramps on the timeline
- Export to MP4 via ffmpeg

Preview and export share one rendering function so they don't drift.

## Run it

```bash
git clone https://github.com/Fats403/klick.git
cd klick
npm install
npm run dev
```

Needs `ffmpeg` on PATH: `brew install ffmpeg`.

Building from source also needs Swift, which comes with `xcode-select --install`. End users of a packaged build don't.

First time you hit Record, macOS asks for **Screen Recording** and **Accessibility**. Grant both, quit (⌘Q) and relaunch — macOS won't pick the grants up otherwise.

## Build

```bash
npm run build:native   # Swift binary only
npm run build          # full app build (runs build:native first)
npm run dist           # also packs a .dmg
```

Not signed yet, so right-click → Open the first time.

## Why a Swift binary

Chromium's `getDisplayMedia` doesn't honor `cursor: 'never'` reliably on macOS. I tried the custom picker path and Electron 32's `useSystemPicker: true` — both left the OS cursor baked into the recording. The binary at `native/klick-capture/main.swift` calls ScreenCaptureKit directly with `showsCursor = false`, encodes constant-framerate H.264 with AVAssetWriter, and exits cleanly on SIGTERM. Electron spawns it on record start.

## Stack

Electron 32 + electron-vite, React 19, Tailwind v4, Zustand, uiohook-napi (cursor/click events), @napi-rs/canvas (export-side overlay), ffmpeg, ScreenCaptureKit + AVFoundation.

## Permissions

- **Screen Recording** — for ScreenCaptureKit. The Swift child inherits this from Electron.
- **Accessibility** — for uiohook-napi to receive global mouse events. Without it the video records fine, just no clicks for the click animations.

## On the list

- Crop region selector (Crop tab is currently a placeholder)
- Bundle ffmpeg so it's not a system dep
- Audio (one flag in the Swift config)
- Auto-suggested zoom segments at click events
- Windows + Linux backends — editor + export are already platform-agnostic
- Code signing + notarization

## Contributing

`npm run dev` for hot reload, `npm run typecheck` to verify. PRs welcome.

## License

MIT.
