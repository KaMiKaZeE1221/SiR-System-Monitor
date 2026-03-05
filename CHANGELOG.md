# Changelog

All notable changes to this project are documented in this file.

## [Unreleased] - 2026-03-05

### Added
- Added `Low Overhead Mode` toggle in the desktop header.
- Added browser lock behavior for Low Overhead Mode (web Summary toggle is hidden/disabled while active).
- Added hover tooltips across key settings and action buttons (desktop + web monitor controls).
- Added tooltip text for dynamic controls (settings accordion toggles, sensor reorder arrows, category expand/collapse toggles).

### Changed
- Restored `Summary Mode` as a standalone desktop button while keeping Low Overhead as a separate control.
- Summary statistics now populate continuously in normal operation (not dependent on being on Summary tab/view).
- Low Overhead Mode now forces Monitoring Mode on and hides Summary controls while enabled.
- Web monitor header now shows a friendly mode label (`Shared Memory`) and update timestamp only.

### Fixed
- Stopped web monitor header from showing zero-value external text such as `FPS: 0 | Frame Time: 0.00ms`.
- Prevented browser Summary mode activation while Low Overhead Mode is enabled.
- Updated startup behavior so launch-at-startup runs minimized without showing the main window unexpectedly.
