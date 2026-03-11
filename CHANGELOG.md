# Changelog

## 1.1.5 - 2026-03-11

### Added
- Export / Import settings: added an in-app JSON export and import flow for user settings and customizations.
- Import preview modal: users can preview incoming settings (including theme and custom colors) before applying.
- Backup & Restore section in Settings: simplified access for exporting current settings and restoring from a file.
- Scrollable release notes area in the in-app updater dialog.
<img width="300" height="400" alt="image" src="https://github.com/user-attachments/assets/f88f0c5d-b180-4c08-a421-dd5657e8c3c1" />

### Fixed
- Improved sensor-selection persistence and drag-and-drop ordering reliability when importing settings.

### UI
- Replaced the textual `Monitoring Mode` header button with a compact settings gear icon that opens/closes the Settings sidebar.
- Swapped the header action order so `Summary Mode` appears before the Settings icon.
- Renamed the small web monitor indicator from `Live` to `Sharing` to better reflect that the app is publishing the web view.


## 1.1.4 - 2026-03-08

### Added
- Discord Rich Presence!
- Settings → Connectivity: Discord Rich Presence dropdown allowing users to enable or disable Rich Presence.

## 1.1.3 - 2026-03-07

### Fixed
- Prevented new installs from auto-launching in Summary Mode (defaults to Monitoring).
- Removed unintended bar/graph icon next to the header app icon.

## 1.1.2 - 2026-03-07

### Added
- Added per-sensor custom naming in Sensor Selection with inline rename editing.
- Added `Reset Custom Sensor Names` control to clear all custom sensor name overrides.

### Changed
- Changed sensor reordering in Sensor Selection to drag-and-drop only by removing up/down arrow controls.
- Improved inline rename field sizing and spacing so text is fully visible while editing.

### Fixed
- Fixed HWiNFO DRAM bandwidth sensors to appear in the Memory section instead of CPU.
- Renamed HWiNFO DRAM bandwidth labels to `Memory Read` and `Memory Write`.
- Fixed sensor rename interaction reliability by replacing dialog-dependent behavior with inline editor flow in Sensor Selection.

## 1.1.1 - 2026-03-07

### Added
- Added temperature unit selector under Appearance settings:
  - Celsius (°C)
  - Fahrenheit (°F)
- Added persistent temperature unit preference so selected unit is remembered across app restarts.

### Changed
- Updated temperature rendering pipeline so converted units are applied consistently across desktop cards, summary values, graph labels, and web monitor payload data.

### Fixed
- Fixed a renderer initialization regression introduced during temperature-unit integration that could prevent sensor updates and disable top-right header button actions.

## 1.1.0 - 2026-03-07

### Added
- Added expanded style preset system for desktop and web monitor views with multiple visual variants:
  - Classic
  - Neon
  - Minimal
  - Glass (WIP)
  - Terminal
- Added per-style group icon sets, synced between desktop and browser views.

### Changed
- Updated the header toggle label from `View` to `Style` to better reflect full visual preset switching.
- Updated style mode switching to sync through the web payload so browser and desktop stay visually aligned.

### Fixed
- Fixed theme switching so accent-driven colors (sensor value, icon, graph, and block header) correctly update when changing color themes.
- Fixed color picker synchronization after theme switches/resets so controls always reflect active applied colors.
- Fixed remaining hard-coded color paths in style presets so custom color settings and themes affect all style variants more consistently.

## 1.0.9 - 2026-03-07

### Changed
- Updated post-download updater messaging to clearly instruct users to press `Restart to Install` after download completes.

### Fixed
- Fixed Web Monitor updates pausing while the desktop app window is minimized by disabling renderer background throttling.
- Fixed Web Summary layout spacing to better match desktop Summary Mode and reduce sensor-name truncation.
- Fixed Web Summary fallback for static sensors (for example `LAN IP`, `WAN IP`, and `Memory Timings`) so they show current values instead of `Collecting summary...`.
- Fixed Web Summary unit handling for network sensors so fan values reliably show `RPM` and total upload/download are treated as totals.
- Fixed Web Summary conversion for total upload/download values to switch from `MB` to `GB` when totals exceed `1024 MB`.

## 1.0.8 - 2026-03-06

### Changed
- Refined browser Summary Mode layout and spacing to better align with the desktop Summary Mode presentation.
- Updated network display labels for readability with long values:
  - `External IP Address` → `WAN IP`
  - `Primary IP Address` → `LAN IP`

### Fixed
- Fixed browser Summary Mode fallback text for static sensors so values are shown instead of `Collecting summary...` when appropriate.
- Fixed browser Summary Mode unit behavior for network sensors, including total upload/download handling and fan unit consistency.
- Fixed browser Summary Mode total upload/download display conversion from `MB` to `GB` once values exceed `1024 MB`.

## 1.0.7 - 2026-03-06

### Changed
- Improved graph performance by updating graph history only when a sensor graph is actually expanded/visible.
- Graph history data is now cleared for sensors whose graph is not expanded to reduce background memory/work.
- Reworked the sensor refresh scheduler to use drift-corrected timing for more consistent 1000ms update cadence.
- Shortened network label text for long values:
  - `External IP Address` → `WAN IP`
  - `Primary IP Address` → `LAN IP`
- Increased Web Monitor layout width to better match desktop panel sizing and reduce cramped card rendering in browser view.

### Fixed
- Fixed unnecessary background graph-history accumulation when no graphs were open.
- Updated README release asset naming to match updater-safe artifact names.
- Fixed occasional apparent "every other second" UI skips by forcing scheduler-driven renders when due.
- Fixed RAM timing display truncation (for example `18-22-22-42` no longer collapsing to `18.00`).

## 1.0.6 - 2026-03-06

### Added
- Added GitHub release updater integration with manual in-app flow:
  - Check for Updates
  - Download Update
  - Restart and Install after download
- Added update status modal and updater state handling in settings.
- Added `Open Latest Release` fallback path for release-page updates.
- Added resizable settings sidebar width via drag handle, with persisted width.
- Added app version to desktop window title (`SiR System Monitor v<version>`).
- Added app version to Web Monitor header metadata line.

### Changed
- Switched update behavior to user-driven/manual (no automatic download/install).
- Updated no-update status text to `No Updates Found`.
- Increased default desktop window size to `1600x900`.
- Setup Guide checkbox (`Don't show this again on startup`) moved to top.
- Setup Guide modal content is now explicitly scrollable.
- Standardized installer artifact names to updater-safe format:
  - `SiR-System-Monitor-Setup-<version>.exe`
  - `SiR-System-Monitor-Portable-<version>.exe`

### Fixed
- Fixed `Open Latest Release` button behavior with reliable fallback URL handling.
- Fixed update download 404 caused by release asset filename mismatch.
- Fixed package bloat regression by excluding `dist*` outputs from packaged app files.
- Restored expected installer size range after output-folder inclusion issue.

## 1.0.5 - 2026-03-05 (estimated)

### Added
- Added desktop `Low Overhead Mode` toggle in the header controls.
- Added per-color customization controls in Settings:
  - Font color
  - Sensor name color
  - Sensor value color
  - Icon color
  - Graph color
  - Sensor block header color
  - Outline color
  - Background color
- Added `Reset to Theme Defaults` action for color customization.
- Added tooltip coverage for major settings/actions and dynamic sensor ordering controls.

### Changed
- Restored `Summary Mode` as a standalone desktop button.
- Summary statistics now populate continuously in normal mode (not dependent on opening Summary tab/view).
- While Low Overhead Mode is active:
  - Monitoring Mode is forced on.
  - Summary stat population is disabled.
  - Summary controls are hidden/locked (desktop and browser view).
- Web monitor header now shows friendly mode label (`Shared Memory`) with last update time.

### Fixed
- Prevented browser Summary mode activation while Low Overhead Mode is enabled.
- Suppressed zero-value external web text like `FPS: 0 | Frame Time: 0.00ms`.
- Fixed sensor selection category collapse/expand button visibility at very large font sizes.
- Fixed title and mode buttons to correctly follow font color customization.
- Fixed desktop Monitoring/Summary/Low Overhead button outlines to follow configured outline color.
- Fixed browser Summary button outline to follow configured outline color.
- Fixed graph line and sensor block header color channels to follow custom color settings across desktop and web.

## 1.0.4 - 2026-03-04 (estimated)

### Added
- Added initial in-app update checker UI in App Behavior settings.
- Added GitHub repository metadata/publish configuration used by update checks.
- Added update status messaging pipeline between main and renderer process.

### Changed
- Updated Electron runtime to `40.7.0`.
- Refined update UX from basic status-only checks toward modal-driven flow.

### Fixed
- Improved handling for missing updater metadata (`latest.yml`) by showing fallback guidance.
- Removed obsolete `Restart to Install Update` sidebar path once modal flow replaced it.

## 1.0.3 - 2026-03-03 (estimated)

### Added
- Added Web Monitor runtime controls in settings (enable, host/port, open URL).
- Added browser-accessible monitor view and JSON endpoint.
- Added setup guide modal for shared-memory provider onboarding.

### Changed
- Improved grouped sensor rendering and category organization for CPU/GPU/RAM/PSU/Fans/Network/Drives/Other.
- Improved persisted app behavior options (startup/minimized/tray integration).

### Fixed
- Fixed tray/minimize/close behavior edge cases.
- Fixed intermittent stale UI refresh behavior under lower activity.

## 1.0.2 - 2026-03-02 (estimated)

### Added
- Added sensor selection panel with per-sensor visibility control.
- Added sensor ordering controls with persisted order.
- Added graph expansion/history for selected sensor rows.

### Changed
- Improved refresh cadence and rendering stability for large sensor lists.
- Improved summary mode readability and group layout behavior.

### Fixed
- Fixed several sensor value formatting and ordering consistency issues.

## 1.0.1 - 2026-03-01 (estimated)

### Added
- Added initial settings sidebar structure and grouped cards layout.
- Added shared-memory provider toggles (RTSS/AIDA64/HWiNFO/LHM).
- Added installer and portable packaging pipeline.

### Changed
- Improved base theme defaults and typography scaling.

### Fixed
- Fixed early startup/runtime stability issues in packaged builds.

## 1.0.0 - 2026-02-29 (estimated)

### Added
- Initial public baseline release of SiR System Monitor.
