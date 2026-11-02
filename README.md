# Linux Recordly

**GitHub description:** Linux-focused Recordly build with Ubuntu/Wayland support for cursor telemetry, auto-zoom, and `.deb` packaging.

**Original project:** https://github.com/webadderallorg/recordly

## Why I built this

I built this because the original Recordly experience did not work reliably on my Ubuntu Wayland desktop.  
Auto-zoom depends on mouse/click interaction telemetry, but Wayland blocks global input capture, so recordings ended with “No clear interaction moments found.”

This project adapts Recordly to work on Ubuntu/Wayland by:

- reading input devices through `/dev/input/event*` when running on Wayland
- improving Linux zoom suggestion logic
- allowing Linux window captures to auto-zoom
- adding `.deb` packaging and GitHub release automation

The goal is to make Recordly usable on Linux without forcing users to switch from Wayland to Xorg.

Recordly is a creator-focused screen recorder with auto-zoom, cursor effects, backgrounds, annotations, and more.

This repository includes Ubuntu/Wayland compatibility work so that cursor/click telemetry and auto-zoom can work on Wayland sessions.

## Ubuntu / Wayland changes

### 1. Evdev-based input capture on Wayland
Linux screen recording already uses the Wayland portal, but global input capture through `uiohook-napi` only works reliably on X11.  
This repo adds `electron/ipc/cursor/evdev.ts`, which reads `/dev/input/event*` directly on Wayland sessions and records:

- pointer motion
- left / right / middle clicks
- cursor position updates for telemetry sampling

### 2. Recording integration
`electron/ipc/register/recording.ts` now uses the evdev capture path when running on a Linux Wayland session, while keeping the existing `uiohook` path for X11 and other platforms.

### 3. Zoom suggestion improvements
`src/components/video-editor/timeline/zoomSuggestionUtils.ts` was updated to:

- allow narrow Linux window captures for automatic fresh-recording zooms
- fall back to dwell-based heuristic interaction moments when no explicit click telemetry exists

### 4. Linux packaging
`electron-builder.json5` now builds both `AppImage` and `deb` targets for Linux.

## Required system setup on Ubuntu

Run these commands in order.

### 1. Install build dependencies
```bash
sudo apt update
sudo apt install -y \
  build-essential \
  python3 \
  libudev-dev \
  libx11-dev \
  libxkbfile-dev \
  x11-utils
```

### 2. Install project dependencies
```bash
cd /home/shahzainomar/Desktop/apps/Recordly-1.4.0
npm install
```

### 3. Make input devices readable
Use this secure per-user rule:

```bash
sudo tee /etc/udev/rules.d/99-recordly-input.rules >/dev/null <<'EOF'
SUBSYSTEM=="input", KERNEL=="event*", GROUP="users", MODE="0660"
EOF
sudo udevadm control --reload-rules
sudo udevadm trigger --subsystem-match=input
test -r /dev/input/event0 && echo "devices readable: YES" || echo "devices readable: NO"
```

Your user must be in the `users` group. If not, add yourself and **log out / log back in**:

```bash
sudo usermod -aG users "$USER"
```

> Logout is required after changing group membership. A new terminal alone is not enough.

### 4. Run the app in development
```bash
npm run dev
```

Expected log during recording:
```text
[EvdevInput] Capturing pointer input from N device(s).
```

### 5. Build the Linux packages
```bash
npm run build:linux
```

Output:
```text
release/Recordly-linux-x64.AppImage
release/Recordly... .deb
```

### 6. Install the generated DEB
```bash
sudo apt install ./release/*.deb
```

## Logout required

- Logout/login is required after:
  - adding your user to a group (`users` or `input`)
  - changing group membership
- The udev rule itself applies immediately after `udevadm trigger`, but group changes do not.

## Wayland notes

- Global input capture is intentionally restricted by Wayland.
- This project’s evdev fallback works only if `/dev/input/event*` is readable.
- If evdev cannot open devices, auto-zoom will fall back to dwell detection when possible, but click-based zooms require readable input devices.
- If you prefer not to use evdev, use the **Ubuntu on Xorg** session and the original X11 input path.

## GitHub automation

Tagged releases automatically build a Linux DEB through:

```text
.github/workflows/build-deb.yml
```

The workflow:

1. triggers on tags matching `v*`
2. installs dependencies
3. runs `npm run build:linux`
4. uploads the `.deb` as an artifact
5. attaches the `.deb` to the GitHub Release

Example:

```bash
git tag v1.4.1
git push origin v1.4.1
```

## Troubleshooting

### `No readable input devices`
- Confirm devices are readable:
  ```bash
  test -r /dev/input/event0 && echo YES || echo NO
  ```
- Re-run the udev rule from step 3.
- Avoid `newgrp` when launching the app; it can break portal permissions.

### Screen capture portal error
If you see:
```text
ScreenCastPortal failed
```
launch the app from a normal terminal after a clean login, not from a modified group shell.

### Zoom still not detected
- Record a longer clip with clear pauses and clicks.
- Use **Suggest zooms** in the editor.
- Check terminal logs for `[EvdevInput]`.
EOF
echo "README written"