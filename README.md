# SiR System Monitor

SiR System Monitor is a Windows Electron desktop app for real-time hardware telemetry with optional browser viewing.

It reads shared-memory data from RTSS/AIDA64/HWiNFO/LHM (when available), provides grouped live cards, sensor selection, summary and low-overhead modes, web monitor output, color customization, and packaged installer/portable builds.

## Table of Contents

- [What It Does](#what-it-does)
- [Screenshots](#screenshots)
- [Requirements](#requirements)
- [Quick Start (Developer)](#quick-start-developer)
- [Run from Installer / Portable](#run-from-installer--portable)
- [Settings Overview](#settings-overview)
- [Sensor Sources](#sensor-sources)
- [Web Monitor](#web-monitor)
- [Project Structure](#project-structure)
- [Build & Packaging](#build--packaging)
- [Troubleshooting](#troubleshooting)
- [Release Checklist](#release-checklist)

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
- Supports per-sensor selection and ordering.
- Supports Monitoring Mode, Summary Mode, and Low Overhead Mode.
- Supports summary mode (min/max session view) with browser summary lockout while Low Overhead Mode is enabled.
- Supports live color customization for:
  - UI font color
  - Sensor name color
  - Sensor value color
  - Outline color
  - Background color
- Supports resetting colors back to defaults for the currently selected theme.
- Exposes a browser-accessible monitor page and JSON endpoint.
- Builds as:
  - NSIS installer
  - Portable EXE

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

## Requirements

- OS: Windows
- Node.js: LTS recommended
- npm: bundled with Node.js

Optional (for richer sensors):

- RTSS / MSI Afterburner
- AIDA64 with Shared Memory enabled
- HWiNFO / LHM shared memory providers

## Settings Overview

Settings are grouped in the sidebar:

- Appearance
  - Color theme
  - Font size/family and text options
  - Custom colors (font, sensor names, sensor values, outline, background)
  - Reset to theme defaults
- Monitoring
  - Monitoring Mode toggle
  - Summary Mode toggle
  - Low Overhead Mode toggle
  - Refresh rate (1000–5000 ms)
  - Visible sensor groups
  - Sensor Selection panel
- Data Sources
  - Detection mode
  - Shared memory provider toggles
- Connectivity
  - Web monitor enable, host/port, open URL
- App Behavior
  - Launch at startup
  - Start minimized
  - Minimize/close to tray

All settings are persisted locally.

## Sensor Sources

Primary runtime path uses shared memory integration:

- RTSS
- AIDA64
- HWiNFO
- LHM

## Web Monitor

When enabled:

- UI endpoint: `http://<host>:<port>/`
- JSON endpoint: `http://<host>:<port>/api/monitor`

Browser behavior highlights:
- Header uses a friendly mode label (`Shared Memory`) with update time.
- Summary view is hidden/locked in browser while Low Overhead Mode is active on desktop.

Useful for viewing selected sensors from another device on LAN (use host `0.0.0.0`), subject to local firewall/network rules.
