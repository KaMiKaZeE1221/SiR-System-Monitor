# SiR System Monitor

SiR System Monitor is a Windows Electron desktop app for real-time hardware telemetry with optional browser viewing.

It reads shared-memory data from RTSS/AIDA64/HWiNFO/LHM (when available), provides grouped live cards, sensor selection controls, summary and low-overhead modes, web monitor output, appearance customization, and packaged installer/portable builds.

## Table of Contents

- [What It Does](#what-it-does)
- [Screenshots](#screenshots)
- [Requirements](#requirements)
- [Settings Overview](#settings-overview)
- [Sensor Sources](#sensor-sources)
- [Sensor Naming & Grouping Notes](#sensor-naming--grouping-notes)
- [Web Monitor](#web-monitor)
- [Updater](#updater)
- [Troubleshooting](#troubleshooting)

## What It Does

- Displays live hardware sensors grouped by:
  - CPU
  - GPU
  - RAM
  - PSU
  - Fans
  - Network
  - Drives
  - Other
- Supports configurable refresh rate and sensor visibility.
- Supports per-sensor selection and drag-and-drop ordering.
- Supports custom sensor names in Sensor Selection with inline rename editing (`✎`).
- Supports resetting all custom sensor names.
- Supports Monitoring Mode, Summary Mode, and Low Overhead Mode.
- Supports summary mode (session min/max view) with browser summary lockout while Low Overhead Mode is enabled.
- Supports appearance customization:
  - Theme presets
  - Style presets (Classic, Neon, Minimal, Glass, Terminal)
  - Font size/family, bold text, monospace values
  - Temperature unit toggle (Celsius/Fahrenheit)
  - Custom colors for UI channels (font, sensor label/value, icon, graph, block header, outline, background)
- Supports resetting colors back to defaults for the currently selected theme.
- Exposes a browser-accessible monitor page and JSON endpoint.

## Requirements

- OS: Windows
- Node.js + npm (for local development)

Optional (for richer sensors):

- RTSS / MSI Afterburner
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
- Monitoring
  - Monitoring Mode toggle
  - Summary Mode toggle
  - Low Overhead Mode toggle
  - Refresh rate (1000–5000 ms)
  - Visible sensor groups
  - Sensor Selection panel
    - per-sensor enabled state
    - drag-and-drop ordering
    - inline rename button per sensor row
    - reset custom sensor names button
- Data Sources
  - Detection mode
  - Shared memory provider toggles
- Connectivity
  - Web monitor enable, host/port, open URL
- App Behavior
  - Launch at startup
  - Start minimized
  - Minimize/close to tray
  - App update controls

All settings are persisted locally.

## Sensor Sources

Primary runtime path uses shared-memory integration:

- RTSS
- AIDA64
- HWiNFO
- LHM

## Sensor Naming & Grouping Notes

- The app applies display-label normalization for common provider naming quirks.
- Network labels are shortened where useful (for example WAN/LAN IP naming).
- HWiNFO DRAM bandwidth sensors are normalized into Memory:
  - `DRAM Read Bandwidth` → `Memory Read`
  - `DRAM Write Bandwidth` → `Memory Write`
- Custom names (from Sensor Selection rename) override normalized labels.

## Web Monitor

When enabled:

- UI endpoint: `http://<host>:<port>/`
- JSON endpoint: `http://<host>:<port>/api/monitor`

Useful for viewing selected sensors from another device on LAN or WAN, subject to local firewall/network rules.

> Use on WAN at your own risk.

## Updater

SiR System Monitor uses `electron-updater` with GitHub Releases as the update source.

Current behavior is manual (user-driven):

- In Settings → App Behavior → App Updates, click **Check for Updates**.
- If no update exists, status shows: **No Updates Found**.
- If an update exists, an in-app modal appears and lets the user choose **Download Update**.
- After download completes, the app shows **Restart and Install**.
- If updater metadata is missing on the release, the app falls back to **Open Latest Release**.

## Troubleshooting

1. Missing sensors

- Ensure provider app is running (AIDA64/HWiNFO/RTSS as needed).
- Check provider toggles in Settings → Data Sources.

2. Browser monitor not reachable

- Verify host/port in Settings → Connectivity.
- If using other devices, use host `0.0.0.0` and allow firewall access.

3. Performance / latency concerns

- Keep refresh rate at 1000ms or higher.
- Close unnecessary overlays/providers not in use.


## Screenshots

1. Main dashboard

![Main Dashboard](docs/screenshots/01-main-dashboard.png)

2. Grouped settings sidebar

![Settings Sidebar](docs/screenshots/02-settings-sidebar.png)

3. Sensor selection and ordering

![Sensor Selection](docs/screenshots/03-sensor-selection.png)

4. Summary mode

![Summary Mode](docs/screenshots/04-summary-mode.png)

5. Web monitor page

![Web Monitor](docs/screenshots/05-web-monitor.png)

6. Color options

![Color Options](docs/screenshots/06-color-options.png)

7. Graphs

![Graphs](docs/screenshots/07-Graphs.png)

8. Updater

![Updater](docs/screenshots/08-Updater.png)

![Update Found](docs/screenshots/09-UpdateFound.png)

![Downloading Update](docs/screenshots/10-DownloadingUpdate.png)
