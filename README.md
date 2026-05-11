# SiR System Monitor

SiR System Monitor is a Windows Electron desktop app for real-time hardware telemetry with optional browser viewing.

It reads shared-memory data from RTSS/AIDA64/HWiNFO/LHM (when available), provides grouped live cards, sensor selection controls, summary mode, web monitor output, overlay support, appearance customization, and packaged installer/portable builds.

## Table of Contents

- [What It Does](#what-it-does)
- [Screenshots](#screenshots)
- [Requirements](#requirements)
- [Settings Overview](#settings-overview)
- [Backup & Restore](#backup--restore---export--import)
- [Sensor Sources](#sensor-sources)
- [Sensor Naming & Grouping Notes](#sensor-naming--grouping-notes)
- [Overlay Notes](#overlay-notes)
- [Web Monitor](#web-monitor)
- [Updater](#updater)
- [Troubleshooting](#troubleshooting)

## What It Does

- Displays live hardware sensors grouped by:
  - FPS
  - CPU
  - GPU
  - RAM
  - PSU
  - Fans
  - Network
  - Ping
  - Drives
  - Other
- FPS group includes FPS and Frame Time as a dedicated first-class panel.
- Supports configurable refresh rate and sensor visibility.
- Supports per-sensor selection, overlay inclusion, and drag-and-drop ordering.
- Supports custom sensor names in Sensor Selection with inline rename editing.
- Supports resetting all custom sensor names.
- Supports Monitoring Mode and Summary Mode.
- Supports appearance customization:
  - Theme presets
  - Style presets (Classic, Neon, Minimal, Terminal)
  - Font size/family, bold text, monospace values
  - Temperature unit toggle (Celsius/Fahrenheit)
  - Custom colors for UI channels (font, sensor label/value, icon, graph, block header, outline, background)
- Supports on-screen overlay customization:
  - Enable/disable toggle
  - Global overlay toggle hotkey
  - Position, style, display/monitor selection
  - Font size slider, unit scale, group spacing, opacity, color controls
  - Per-category line limits (advanced section)
  - Ping host targeting for latency statistics
- Supports an in-app setup guide (book icon in header).
- Exposes a browser-accessible monitor page and JSON endpoint.

## Requirements

- OS: Windows 10+ (may work on earlier versions but not officially tested).

## At least one of these is required to show sensors

- RTSS / MSI Afterburner (primarily for FPS/Frame Times)
- AIDA64 with Shared Memory enabled
- HWiNFO / LHM shared memory providers

## Settings Overview

Settings are grouped in the sidebar:

- Appearance
  - Color theme
  - Style preset
  - Font size/family and text options
  - Temperature unit selector (°C / °F)
  - Custom colors (font, sensor names, sensor values, icon, graph, sensor block headers, outline, background)
  - Reset to theme defaults
  - On-Screen Overlay settings
- Monitoring
  - Refresh rate (1000-5000 ms)
  - Ping host target for latency sampling
  - Visible sensor groups (including FPS)
  - Sensor Selection panel
    - per-sensor enabled state
    - per-sensor overlay state
    - drag-and-drop ordering
    - inline rename button per sensor row
    - reset custom sensor names button
- Data Sources
  - Shared memory provider toggles
- Connectivity
  - Web monitor enable, host/port, open URL
  - Discord Rich Presence (enable / disable)
- App Behavior
  - Launch at startup
  - Start minimized
  - Minimize/close to tray
  - App update controls

All settings are persisted locally.

### Backup & Restore / Export & Import

SiR System Monitor provides an in-app Export and Import flow to back up your current settings or restore them from a JSON file.

- Export: produces a JSON file containing your active settings including theme, style preset, temperature unit, custom colors, appearance options, sensor selection and ordering, connectivity settings (web monitor host/port), and updater preferences.
  - Also includes overlay and ping additions such as per-category overlay line limits, advanced overlay limits panel state, and ping host target.
- Import: opens a preview modal showing which settings will change. You can choose **Apply Now** to apply settings immediately without a full reload, or **Apply & Reload** to apply settings and restart the renderer.

Usage:

1. Open Settings -> Backup & Restore.
2. Click **Export** to save a JSON snapshot of the current settings.
3. Click **Import** and select a previously exported JSON file to preview its values.
4. Use **Apply Now** to apply the visible changes instantly, or **Apply & Reload** to apply and restart the UI for a fuller effect.

Notes:

- Exported files are portable between installs of the same app version family; major version upgrades may change settings semantics.

### Discord Rich Presence

- Presence is enabled by default.
- To disable Rich Presence: open Settings -> Connectivity -> Discord Rich Presence -> select **Disabled**.

## Sensor Sources

Primary runtime path uses shared-memory integration:

- RTSS
- AIDA64
- HWiNFO
- LHM

## Sensor Naming & Grouping Notes

- The app applies display-label normalization for common provider naming quirks.
- Custom names (from Sensor Selection rename) override normalized labels.
- In grouped-line overlay style, `Network` is shortened to `NET`.

## Overlay Notes

- Overlay uses selected sensors and updates live.
- Overlay can be toggled from:
  - Header `Overlay: On/Off` button
  - Global overlay hotkey
- At minimum background opacity, overlay background/border surfaces are fully transparent.
- When using different Font Size and Unit Scale values, sensor row baseline alignment is preserved.

## Web Monitor

When enabled:

- UI endpoint: `http://<host>:<port>/`
- JSON endpoint: `http://<host>:<port>/api/monitor`
- When web monitor is active, the header shows `Sharing` status.

Network binding guidance:

- Use `127.0.0.1` for local-only access.
- Use `0.0.0.0` to listen on all interfaces (LAN). This can also allow WAN/public access if firewall rules, router port forwarding, or public network exposure permit it.

## Updater

SiR System Monitor uses `electron-updater` with GitHub Releases as the update source.

Current behavior is manual (user-driven):

- In Settings -> App Behavior -> App Updates, click **Check for Updates**.
- If no update exists, status shows: **No Updates Found**.
- If an update exists, an in-app modal appears and lets the user choose **Download Update**.
- After download completes, the app shows **Restart to Install**.
- If updater metadata is missing on the release, the app falls back to **Open Latest Release**.

## Troubleshooting

1. Missing sensors

- Ensure provider app is running (AIDA64/HWiNFO/RTSS as needed).
- Check provider toggles in Settings -> Data Sources.

2. FPS / Frame Time issues

- Ensure RTSS/MSI is running and actively updating.
- Keep RTSS provider enabled in Shared Memory Sources.

3. Browser monitor not reachable

- Verify host/port in Settings -> Connectivity.
- If using other devices, use host `0.0.0.0` and allow firewall access.

4. Performance / latency concerns

- Keep refresh rate at 1000ms or higher.
- Close unnecessary overlays/providers not in use.

## Screenshots

More screenshots on Imgur
https://imgur.com/a/pkG1Cyb

<img width="1920" height="1032" alt="Standard_View" src="https://github.com/KaMiKaZeE1221/SiR-System-Monitor/blob/main/Screenshots/SiR_System_Monitor_Orange.png" />
<img width="1920" height="1032" alt="Standard_View" src="https://github.com/KaMiKaZeE1221/SiR-System-Monitor/blob/main/Screenshots/SiR_System_Monitor_Blue.png" />
<img width="1920" height="1032" alt="Standard_View" src="https://github.com/KaMiKaZeE1221/SiR-System-Monitor/blob/main/Screenshots/SiR_System_Monitor_Cyan.png" />
<img width="1920" height="1032" alt="Standard_View" src="https://github.com/KaMiKaZeE1221/SiR-System-Monitor/blob/main/Screenshots/SiR_System_Monitor_Green.png" />
<img width="1920" height="1032" alt="Standard_View" src="https://github.com/KaMiKaZeE1221/SiR-System-Monitor/blob/main/Screenshots/SiR_System_Monitor_Purple.png" />
<img width="1920" height="1032" alt="Standard_View" src="https://github.com/KaMiKaZeE1221/SiR-System-Monitor/blob/main/Screenshots/SiR_System_Monitor_Red.png" />
