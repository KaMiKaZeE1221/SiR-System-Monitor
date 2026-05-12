# SiR System Monitor

A Windows Electron desktop app for real-time hardware telemetry, overlay display, and optional browser-based monitoring.

## :books: Contents
- [Overview](#computer-overview)
- [Core Features](#sparkles-core-features)
- [Requirements](#white_check_mark-requirements)
- [Settings Overview](#gear-settings-overview)
- [Backup and Restore](#floppy_disk-backup-and-restore)
- [Data Sources](#test_tube-data-sources)
- [Overlay Notes](#window-overlay-notes)
- [Web Monitor](#globe_with_meridians-web-monitor)
- [Updater](#arrows_counterclockwise-updater)
- [Troubleshooting](#rescue_worker_helmet-troubleshooting)
- [Tech Stack](#hammer_and_wrench-tech-stack)
- [Screenshots](#framed_picture-screenshots)

## :computer: Overview
SiR System Monitor is designed for users who want a fast, configurable view of system telemetry without needing to keep multiple monitoring apps in the foreground.

The app reads shared-memory telemetry from RTSS, AIDA64, HWiNFO, and Libre Hardware Monitor (when available), then presents it through grouped live cards, configurable sensor visibility, summary mode, overlay output, and web sharing.

## :sparkles: Core Features
- :bar_chart: Live grouped sensors:
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
- :dart: Dedicated FPS + Frame Time panel
- :jigsaw: Per-sensor controls:
  - Enable/disable
  - Overlay include/exclude
  - Drag-and-drop ordering
  - Inline rename
  - Reset custom names
- :window: Monitoring Mode and Summary Mode
- :art: Appearance customization:
  - Theme presets
  - Style presets (`Classic`, `Neon`, `Minimal`, `Terminal`)
  - Font family and size
  - Bold text and monospace value options
  - Temperature unit (`C` / `F`)
  - Full UI color controls
- :tools: Overlay customization:
  - On/off toggle
  - Global hotkey toggle
  - Position and monitor selection
  - Font size, scaling, spacing, opacity
  - Per-category line limits
  - Category reorder and reset
- :globe_with_meridians: Web monitor UI and JSON endpoint
- :blue_book: In-app setup guide
- :package: Installer + portable build support

## :white_check_mark: Requirements
- Windows 10 or newer
- At least one sensor provider:
  - RTSS / MSI Afterburner
  - AIDA64 (Shared Memory enabled)
  - HWiNFO (Shared Memory enabled)
  - Libre Hardware Monitor (Shared Memory enabled)

## :gear: Settings Overview
All settings are persisted locally and survive app restarts.

### :art: Appearance
- Theme and style presets
- Font and text options
- Temperature unit
- Custom colors:
  - Font
  - Sensor labels
  - Sensor values
  - Icon
  - Graph
  - Block headers
  - Outline
  - Background
- Overlay settings

### :chart_with_upwards_trend: Monitoring
- Refresh rate (`1000-5000 ms`)
- Ping host target
- Visible sensor groups
- Sensor Selection controls

### :electric_plug: Data Sources
- Provider toggles for shared-memory sources

### :globe_with_meridians: Connectivity
- Web monitor host/port
- Open monitor URL action
- Discord Rich Presence toggle

### :brain: App Behavior
- Launch at startup
- Start minimized
- Minimize/close to tray
- Auto-check updates on startup
- Startup delay (`0-300 seconds`)
- Manual update controls

## :floppy_disk: Backup and Restore
Built-in **Export** and **Import** are available under `Settings -> Backup & Restore`.

- Export creates a JSON snapshot of your current settings.
- Import opens a preview before applying changes.
- Apply options:
  - `Apply Now`
  - `Apply & Reload`

The export includes appearance preferences, monitoring options, provider toggles, web monitor settings, overlay configuration, and update-related behavior.

## :test_tube: Data Sources
Primary runtime provider path:
- RTSS
- AIDA64
- HWiNFO
- Libre Hardware Monitor

### :compass: Recommended first-time setup
1. Enable only the providers you actively use in `Settings -> Data Sources`.
2. Confirm shared-memory output is enabled in each provider app.
3. Enable desired groups in `Monitoring -> Visible Sensors`.
4. Configure per-sensor options in `Monitoring -> Sensor Selection`.
5. Configure overlay behavior in `Appearance -> On-Screen Overlay`.
6. Configure host/port in `Connectivity -> Web Monitor`.
7. Configure startup and update behavior in `App Behavior`.

### Provider tips
- RTSS/MSI Afterburner is the most common source for FPS/frame-time telemetry.
- HWiNFO and AIDA64 often expose overlapping sensors, so enabling only what you need helps keep the sensor list cleaner.
- If a provider is closed or shared memory is disabled, its sensors will not populate.

## :window: Overlay Notes
- Uses your selected sensors and updates live.
- Can be toggled from:
  - Header `Overlay: On/Off` button
  - Global overlay hotkey
- Category order is user-configurable.
- Grouped-line style shortens `Network` to `NET`.
- Per-category line limits can reduce overlay clutter on smaller displays.

## :globe_with_meridians: Web Monitor
When enabled:
- UI: `http://<host>:<port>/`
- JSON: `http://<host>:<port>/api/monitor`

Host guidance:
- `127.0.0.1` for local-only access
- `0.0.0.0` for WAN/LAN access (Allow WAN at your own risk!)

Security note:
- If you expose the monitor beyond localhost, use firewall rules and trusted networks only.

## :arrows_counterclockwise: Updater
Current flow:
1. Open `Settings -> App Behavior -> App Updates`.
2. Click **Check for Updates**.
3. If available, choose **Download Update**.
4. After download, choose **Restart to Install**.

If release metadata is missing, the app falls back to **Open Latest Release**.

## :rescue_worker_helmet: Troubleshooting
### :question: Missing sensors
- Ensure provider apps are running.
- Verify source toggles in `Settings -> Data Sources`.
- Confirm shared-memory output is enabled in each provider.

### :video_game: FPS / Frame Time not updating
- Ensure RTSS/MSI Afterburner is running.
- Keep RTSS provider enabled.
- Check that another overlay/OSD tool is not conflicting with RTSS output.

### :globe_with_meridians: Browser monitor unreachable
- Verify host/port in `Settings -> Connectivity`.
- For WAN/LAN use, set host to `0.0.0.0` and allow firewall access.
- Test local access first (`127.0.0.1`) before trying another device.

### :zap: Performance concerns
- Keep refresh rate at `1000 ms` or higher.
- Disable unused providers and overlays.
- Reduce visible sensor groups if rendering appears heavy.

## :hammer_and_wrench: Tech Stack
- Electron
- Node.js
- `electron-updater`
- `systeminformation`
- `koffi`

## :framed_picture: Screenshots
More screenshots: [Imgur Album](https://imgur.com/a/pkG1Cyb)

![Orange Theme](./Screenshots/SiR_System_Monitor_Orange.png)
![Blue Theme](./Screenshots/SiR_System_Monitor_Blue.png)
![Cyan Theme](./Screenshots/SiR_System_Monitor_Cyan.png)
![Green Theme](./Screenshots/SiR_System_Monitor_Green.png)
![Purple Theme](./Screenshots/SiR_System_Monitor_Purple.png)
![Red Theme](./Screenshots/SiR_System_Monitor_Red.png)
