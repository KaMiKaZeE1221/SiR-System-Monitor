# Changelog

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
- Improved graph performance by updating graph history only when a sensor graph is actually expanded/visible.
- Graph history data is now cleared for sensors whose graph is not expanded to reduce background memory/work.
- Improved sensor updating cycle, previously it would skip a refresh of the sensors (Might need to adjust the update rate in AIDA/RTSS/HWINFO)

### Changed
- Switched update behavior to user-driven/manual (no automatic download/install).
- Updated no-update status text to `No Updates Found`.
- Increased default desktop window size to `1600x900`.
- Setup Guide checkbox (`Don't show this again on startup`) moved to top.
- Setup Guide modal content is now explicitly scrollable.
- Standardized installer artifact names to updater-safe format:
  - `SiR-System-Monitor-Setup-<version>.exe`
  - `SiR-System-Monitor-Portable-<version>.exe`
  - Reworked the sensor refresh scheduler to use drift-corrected timing for more consistent 1000ms update cadence.
- Shortened network label text for long values:
  - `External IP Address` → `WAN IP`
  - `Primary IP Address` → `LAN IP`
- Increased Web Monitor layout width to better match desktop panel sizing and reduce cramped card rendering in browser view.

### Fixed
- Fixed `Open Latest Release` button behavior with reliable fallback URL handling.
- Fixed update download 404 caused by release asset filename mismatch.
- Fixed package bloat regression by excluding `dist*` outputs from packaged app files.
- Restored expected installer size range after output-folder inclusion issue.
- Fixed unnecessary background graph-history accumulation when no graphs were open.
- Fixed Memory Timings showing only as the first latency, it should now show the entire latency including the command rate.

## 1.0.5 - 2026-03-05

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

## 1.0.4 - 2026-03-04

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

## 1.0.3 - 2026-03-03

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

## 1.0.2 - 2026-03-02

### Added
- Added sensor selection panel with per-sensor visibility control.
- Added sensor ordering controls with persisted order.
- Added graph expansion/history for selected sensor rows.

### Changed
- Improved refresh cadence and rendering stability for large sensor lists.
- Improved summary mode readability and group layout behavior.

### Fixed
- Fixed several sensor value formatting and ordering consistency issues.

## 1.0.1 - 2026-03-01

### Added
- Added initial settings sidebar structure and grouped cards layout.
- Added shared-memory provider toggles (RTSS/AIDA64/HWiNFO/LHM).
- Added installer and portable packaging pipeline.

### Changed
- Improved base theme defaults and typography scaling.

### Fixed
- Fixed early startup/runtime stability issues in packaged builds.

## 1.0.0 - 2026-02-29

### Added
- Initial public baseline release of SiR System Monitor.
