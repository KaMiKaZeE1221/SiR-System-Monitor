# Changelog

## 1.3.2 - 2026-07-22

### Added
- Added a dedicated **Appearance → Animations** section with a master interface-motion switch and separate controls for settings dropdowns, menus and dialogs, dashboard/Summary transitions, and sensor-card icons.
- Added symmetric fade-and-fly motion to Help, Diagnostics, update, import, and confirmation dialogs.
- Added lightweight dashboard-to-Summary transitions and subtle sensor-card header icon motion in both the desktop app and Web Monitor.
- Added a separate **Settings icons** animation option that applies the same lightweight live and hover motion across settings categories, dropdowns, controls, and inline icons. Motion inside collapsed content is paused to avoid unnecessary rendering work.
- Added Calm, Standard, and Lively animation-speed presets plus Gentle, Balanced, and Expressive motion-intensity presets. Both settings apply across desktop disclosures, dialogs, Summary transitions, settings icons, sensor-card icons, and matching Web Monitor effects.
- Added **Create Support Bundle** to Diagnostics. It produces a standard ZIP containing a fresh system report, current diagnostic output, settings, sensor catalogue, and runtime state after redacting user/computer names, profile paths, network identifiers, credentials, custom hosts, and custom sensor names.
- Added a reusable theme-aware in-app dialog for confirmations and status messages so support and profile workflows follow the selected theme and custom color palette.

### Changed
- Restored smooth open and close motion for both main settings categories and their individual setting sections, using measured content heights so short and tall panels animate consistently without clipping.
- Added subtle active-state motion to settings category and section icons while keeping the effects lightweight and scoped to the settings panel.
- Moved the former settings-animation preference out of Font Settings and migrated it into the unified animation configuration. All animation choices are saved locally, included in profiles/imports/exports, and synchronized with the Web Monitor where the matching interface is available.
- Changed **Create Support Bundle** to warn before running all six curated diagnostics sequentially, clear the previous results, preserve every pass/failure/timeout in the combined report, and create the ZIP only after the suite finishes. Explicit cancellation stops the suite without creating a bundle.
- Expanded **Sensor Startup Timing** output with individual processor, graphics, motherboard, and peripheral availability times plus the slowest snapshot-response duration, making hidden collector stalls directly visible in support reports.

### Fixed
- Fixed the V1.2.9/V1.3.0 settings redesign overriding accordion transitions with immediate `display: none` behavior.
- Fixed Windows' reduced-motion preference silently overriding an unchecked `Disable settings animations` option, which made dropdowns open and close instantly even though the settings sidebar still animated. The in-app option is now authoritative.
- Fixed category and subsection closing motion appearing nearly instant by replacing the unreliable CSS `height: auto` transition with measured numeric `max-height` transitions and matching open/close durations and easing.
- Fixed modal close actions removing Help and Diagnostics immediately instead of allowing a matching fly-out animation to finish.
- Fixed settings icons shifting inside their tiles while animated by moving the transform from each icon's layout box to its Bootstrap glyph pseudo-element.
- Fixed settings-profile save, validation, rename, and delete actions opening native white Windows dialogs instead of theme-aware app dialogs.
- Fixed direct USB PSU polling blocking the complete sensor snapshot for roughly eight seconds when a sequence of HID requests timed out. Thermaltake, Corsair, and NZXT polling now runs independently in the background, never blocks the primary sensor response, and retains the last valid reading for up to 15 seconds across transient device timeouts.

## 1.3.1 - 2026-07-22

### Added
- Added a first-class App sensor group for SiR's own CPU and memory usage, process/window counts, uptime, refresh and update timings, hardware sensor counts, active alerts, and Web Monitor connections.
- Added App to Visible Sensors, Sensor Selection, per-sensor naming/reset and ordering, overlays, alerts, normal and Summary layouts, Web Monitor, profiles, and exported settings.
- Added a Diagnostics button to the dashboard header with a themed support page, one-at-a-time execution, cancellation, combined copyable results, and a resizable output box.
- Added six curated end-user diagnostics: System & App Report, Quick Sensor Check, Enhanced Hardware Check, Sensor Startup Timing, Collector Recovery Check, and Sensor Performance Benchmark.
- Added diagnostics allowlist/runner/UI regression coverage and Task Manager-comparable app-memory coverage.

### Changed
- App telemetry is sampled through Electron's in-process metrics API on the existing sensor refresh cycle, without another background process or independent polling timer.
- Diagnostic scripts run through the bundled Electron runtime with fixed arguments, bounded output, per-check timeouts, and no arbitrary command or script-path access.
- Renamed the optional detailed memory sensor to `SiR Working Set Memory` so shared working-set pages remain available without being confused with Task Manager's primary app-memory figure.

### Fixed
- Fixed `SiR Memory Usage` adding every Electron process's full working set, which counted shared Chromium/Electron pages and could report roughly 440-450 MB when Task Manager showed about 120 MB. It now uses aggregate private memory on Windows and falls back to working set only when private memory is unavailable.

## 1.3.0 - 2026-07-22

### Added
- Added an independent Summary Mode layout selector under Appearance, with Compact, Balanced, Wide, Stacked, and Custom choices matching normal mode.
- Added independent Summary Mode card ordering so cards can be rearranged without changing their normal dashboard order.
- Added dedicated settings-panel background, accent, and icon colors while keeping the rest of the dashboard palette independent.
- Added current settings-layout and overlay-editor screenshots to the README.
- Carried forward the V1.2.9 Intel RAPL diagnostics for domains that do not report usable energy-counter data.
- Carried forward the V1.2.9 automatic GPU-vendor and FPS capture-method diagnostics, including AMD displayed-frame timing and presented-frame fallback.
- Carried forward the V1.2.9 individual reset-name button beside every detected sensor rename control.
- Carried forward the V1.2.9 persistent `Hide Unticked` / `Show All` Sensor Selection filter, including profile and export support.
- Carried forward the V1.2.9 settings-wide search that opens matching controls without overwriting saved accordion state.

### Changed
- Normal and Summary modes now keep separate layout presets, Custom layout configurations, per-card dimensions, and card order.
- The Web Monitor payload now carries both normal and Summary card geometry/order and applies the correct arrangement when browser Summary Mode is toggled.
- Extended settings profiles and exported settings to include Summary layout configuration, Summary card sizes/order, and all settings-panel colors.
- Carried forward the V1.2.9 validation that publishes Intel CPU Package, Cores, Memory/DRAM, and Platform/PSys power sensors only after their RAPL domains produce a valid reading.
- Carried forward the V1.2.9 move of Sensor Sources into Monitoring and removal of the separate Data Sources group.
- Carried forward the V1.2.9 36-column Custom layout with fine width control and dense packing below shorter cards in the desktop app and Web Monitor.
- Carried forward the V1.2.9 Sensor Sources diagnostics that distinguish active Intel package power from optional unavailable processor/platform domains.
- Carried forward the V1.2.9 settings-workspace redesign with flat category surfaces, responsive fields, modern switches, and clearer action hierarchy.
- Carried forward the V1.2.9 single-surface On-Screen Overlay editor for placement, sizing, arrangement, content, and colors.

### Fixed
- Fixed resizing cards in Summary Mode also changing the corresponding cards in the normal dashboard.
- Fixed Web Monitor Summary Mode inheriting the normal dashboard's card dimensions or order instead of its own layout.
- Carried forward the V1.2.9 fix for unsupported Intel Memory and Platform power domains appearing permanently as `0 W` sensors.
- Carried forward the V1.2.9 AMD native FPS/frame-time fixes using installed-adapter detection, hybrid/display tracking, and displayed/presented/QPC timing fallbacks.
- Carried forward the V1.2.9 PresentMon cleanup and stale ETW-session recovery fix for forced capture shutdowns and Windows error 1450.
- Carried forward the V1.2.9 Custom layout fixes for coarse width jumps and blank areas below shorter cards.
- Carried forward the V1.2.9 fix for AMD and NVIDIA Native FPS/Frame Time samples being discarded because capture-relative and system-wide timestamps were compared incorrectly.

## 1.2.9 - 2026-07-21

### Added
- Added explicit diagnostics for Intel RAPL domains that do not report usable energy-counter data.
- Added automatic GPU-vendor and FPS capture-method diagnostics, with AMD displayed-frame timing and presented-frame fallback.
- Added an individual reset-name button beside every detected sensor's rename button.
- Added a persistent `Hide Unticked` / `Show All` control beside Sensor Selection search. It combines with search, hides empty categories, and is included in settings profiles and exports.
- Added settings-wide search that locates and opens matching controls across every category without overwriting the user's saved accordion state.

### Changed
- Intel CPU Package, Cores, Memory/DRAM, and Platform/PSys power sensors are now published only after their corresponding RAPL energy counters produce a valid reading.
- Moved Sensor Sources into the Monitoring group and removed the separate Data Sources group.
- Reworked Custom card sizing into a 36-column, fine-grained dense layout shared by the desktop app and Web Monitor. Shorter cards can now have later cards packed directly beneath them instead of reserving the tallest card's full row.
- Updated the Sensor Sources status to distinguish an active Intel package-power sensor from optional processor/platform domains that are not exposed by the current CPU, firmware, or driver.
- Redesigned the complete settings workspace with one surface per category, flat expandable setting rows, clearer category descriptions, modern switch controls, responsive field grids, and a neutral/primary action hierarchy.
- Rebuilt On-Screen Overlay settings as a single structured editor with placement, sizing, arrangement, content, and color sections instead of the previous triple-nested card layout.

### Fixed
- Fixed unsupported Intel CPU Memory and Platform power domains appearing as permanent `0 W` sensors. Valid domains remain available after their first real sample, and a later genuine zero remains visible instead of being mistaken for an unsupported sensor.
- Fixed native FPS and frame time remaining at zero on affected AMD systems by detecting installed adapters, enabling hybrid/display tracking for AMD, and preferring `MsBetweenDisplayChange` with `MsBetweenPresents` and QPC timing as fallbacks.
- Fixed forced PresentMon shutdowns leaving abandoned ETW trace sessions that could eventually prevent new captures from starting with Windows error 1450. The sensor host now shuts down its trace cleanly and recovers orphaned SiR sessions before starting.
- Fixed Custom layout width resizing jumping by entire large grid columns and fixed blank vertical areas beneath shorter cards.
- Fixed Native FPS and Native Frame Time remaining at zero across AMD and NVIDIA systems because capture-relative PresentMon timestamps were being compared with the system-wide stopwatch timeline and discarded before a valid sample window could form.

## 1.2.8 - 2026-07-21

### Added
- Added a lightweight persisted sensor catalogue so enabled sensor rows can appear immediately as `Detecting...` during cold enhanced-hardware discovery without presenting stale readings as live data.
- Added startup timing, forced collector recovery, enabled-alert filtering, sensor catalogue cache, enhanced-administrator migration, and window visibility regression coverage.

### Changed
- Split enhanced hardware discovery into independent processor, graphics, motherboard/controller, and storage/network phases so one slow hardware family no longer blocks every enhanced sensor group.
- Reduced the native sensor-host failure retry delay from ten seconds to 1.5 seconds and temporarily retains the latest valid snapshot during a transient collector restart.
- Enhanced Hardware Sensors now also enables `Launch app as administrator`, including one-time migration for existing installations and normalization of legacy profiles/imported settings.
- Updated the themed Enhanced Hardware Sensors confirmation to explain that Windows will request administrator access on future launches.
- Sensor Alert selection now contains only individually enabled sensors from enabled categories and refreshes immediately when those selections change.

### Fixed
- Fixed enhanced sensor cards disappearing for roughly ten seconds after applying or switching profiles by avoiding unnecessary reloads and gracefully closing the collector before required reloads.
- Fixed cold-launch sensor visibility by progressively publishing each detected hardware family and preserving placeholder rows until live values arrive.
- Fixed a startup window race where a manually opened window could minimize itself back to the tray when sensor detection completed.
- Fixed normal non-tray launches remaining hidden until the full sensor catalogue had loaded; the main window now appears at DOM readiness.

## 1.2.7 - 2026-07-21

### Added
- Added a lightweight persisted sensor catalogue so enabled sensor rows can appear immediately as `Detecting...` during cold enhanced-hardware discovery without presenting stale readings as live data.
- Added startup timing, forced collector recovery, enabled-alert filtering, sensor catalogue cache, enhanced-administrator migration, and window visibility regression coverage.
- Added a consent-driven, hash-verified bundled PawnIO driver installer for Intel RAPL package-power and other protected Enhanced Hardware Sensor readings, with driver and package-power diagnostics in Data Sources.
- Added signed, hash-verified PresentMon 2.4.1 presentation-event capture to the native sensor host, providing common `Native FPS` and `Native Frame Time` sensors for AMD, NVIDIA, and Intel GPUs without a separate installation.

### Changed
- Split enhanced hardware discovery into independent processor, graphics, motherboard/controller, and storage/network phases so one slow hardware family no longer blocks every enhanced sensor group.
- Reduced the native sensor-host failure retry delay from ten seconds to 1.5 seconds and temporarily retains the latest valid snapshot during a transient collector restart.
- Enhanced Hardware Sensors now also enables `Launch app as administrator`, including one-time migration for existing installations and normalization of legacy profiles/imported settings.
- Updated the themed Enhanced Hardware Sensors confirmation to explain that Windows will request administrator access on future launches.
- Sensor Alert selection now contains only individually enabled sensors from enabled categories and refreshes immediately when those selections change.
- Changed CPU aggregate power selection to use sensor type and prefer the package-power domain instead of relying on ambiguous label matching.

### Fixed
- Fixed enhanced sensor cards disappearing for roughly ten seconds after applying or switching profiles by avoiding unnecessary reloads and gracefully closing the collector before required reloads.
- Fixed cold-launch sensor visibility by progressively publishing each detected hardware family and preserving placeholder rows until live values arrive.
- Fixed a startup window race where a manually opened window could minimize itself back to the tray when sensor detection completed.
- Fixed normal non-tray launches remaining hidden until the full sensor catalogue had loaded; the main window now appears at DOM readiness.
- Fixed **Enable Browser View** not immediately starting or stopping the Web Monitor, and synchronized the header Web button with the requested runtime state so it can enable a service whose settings checkbox was previously off.
- Serialized Web Monitor start/stop transitions to prevent rapid setting and header changes from racing each other.
- Fixed Intel CPU package-power readings being absent or represented by invalid zero sensors when the required low-level driver was unavailable, and disambiguated CPU sensors that share a base name across temperature, voltage, clock, and power types.
- Fixed native FPS being limited to AMD's vendor-specific LibreHardwareMonitor sensor; FPS now follows the foreground rendering process across supported GPU vendors and keeps the last active game selected while the dashboard is focused.
- Fixed custom sensor names not updating in the Web Monitor until SiR was restarted; rename changes are now applied to and immediately republished in the live browser payload.

## 1.2.6 - 2026-07-21

### Added
- Added the bundled `SiR.SensorHost` collector for CPU load, memory, drive, and network telemetry without a separate monitoring application.
- Added optional Enhanced Hardware Sensors using the bundled LibreHardwareMonitor library for supported GPU, temperature, clock, power, voltage, fan, and FPS readings.
- Added isolated line-delimited JSON IPC between Electron and the persistent sensor host.
- Added sensor-host build, integration-test, benchmark, and packaging support.
- Added a searchable Sensor Selection list.
- Added a built-in overall CPU Clock Speed sensor, with enhanced average-clock data used when available.
- Enabled native enhanced telemetry for supported digital PSUs and clearly labelled motherboard +12 V, +5 V, and +3.3 V rails.
- Added direct native USB telemetry for Thermaltake DPS/iRGB PSUs using VID `264A`, PID `2329`, including AC input voltage, rail voltage/current/power, total output power, temperature, and fan speed.
- Added protocol-aware, read-only native telemetry for 15 Corsair HXi/RMi USB IDs, covering HX550i through current HX1200i/HX1500i generations.
- Added native PMBus-over-HID telemetry for NZXT E500, E650, and E850 digital PSUs, including five output rails, temperature, fan speed, and total output power.
- Added an auditable hardware support registry and packaged `HARDWARE-SUPPORT.md` covering direct PSU IDs, intentional incompatible-protocol exclusions, and common enhanced-mode controller families.
- Added an administrator restart confirmation when enabling Enhanced Hardware Sensors.
- Changed the Enhanced Hardware Sensors confirmation to an in-app dialog that follows the selected theme and custom colors.
- Added shared Compact, Balanced, Wide, and Stacked sensor-card layout presets under Appearance.
- Added a Custom layout mode that enables card resize handles and preserves its manual geometry separately from fixed presets.
- Added layout preset, card order, card dimensions, graph state, sidebar width, and complete overlay preference coverage to settings profiles and exported settings.
- Added a saved Startup & Tray option to request administrator privileges whenever the app launches.

### Changed
- Changed the default data source to Built-in Sensors; RTSS, AIDA64, HWiNFO, and LHM shared-memory sources are now optional compatibility providers.
- Added curated default selection for built-in sensors so expanded hardware discovery does not flood the dashboard.
- Moved standard sensor sampling away from synchronous per-refresh PowerShell processes.
- Corrected network transferred-data units and added automatic binary scaling for B/s through TB/s and MB through TB.
- Changed built-in memory read/write telemetry to useful Windows memory activity rates and added automatic B/s through TB/s scaling across desktop, web, and overlay views.
- Corrected Sensor Selection category collapsing while a search is active.
- Applied the SiR product name, AppUserModelID, and icon identity to Windows task grouping and Electron subprocesses.
- Unified desktop and Web Monitor card width, height, spacing, padding, and box sizing so both views follow the selected layout consistently.
- Changed active Web Monitor, Discord, and Overlay header controls to follow the selected theme accent instead of using hard-coded green styling.
- Kept direct PSU polling telemetry-only, cached sub-second repeat requests, and throttled unavailable-device retries to protect host and application performance.

### Fixed
- Fixed installed builds missing `resources/app-update.yml`, and added a writable GitHub-feed fallback so update checks no longer fail with a local `ENOENT` error.
- Fixed sensor reordering being disabled by an active Sensor Selection search.
- Fixed filtered reordering so hidden sensors retain their relative positions.
- Stabilized drag edge-scrolling and allowed mouse-wheel, trackpad, arrow-key, and page-key scrolling while a sensor is grabbed.
- Removed the obsolete Web Monitor empty-state instruction that referred to MSI mode.
- Fixed grouped-line overlay values being clipped by measuring the longest configured line and widening the OSD panel without wrapping it.
- Fixed the grouped-line overlay briefly collapsing and re-expanding on every sensor refresh.
- Fixed the installer finish-page administrator option by launching through the desktop user with an explicit elevation request and application-side fallback.

## 1.2.5 - 2026-05-13

### Added
- Added named Settings Profiles in `Backup / Restore`:
  - Save current settings as a profile
  - Apply selected profile
  - Rename selected profile
  - Delete selected profile
- Added clearer profile UX labels to distinguish:
  - profile name input (used for Save/Rename)
  - saved profile selector (used for Apply)
- Added safer Web Monitor controls under Connectivity:
  - `Require Access Token` toggle
  - `Read-only mode (API only)` toggle
  - `Generate New Token` action
  - `Copy Token` action
- Added live bind-risk warning text when using wide host bindings (`0.0.0.0` / `::`).
- Added per-sensor alert rules in Monitoring:
  - condition operator
  - threshold
  - cooldown
  - severity (`Warning` / `Critical`)
- Added visual alert-state highlighting for triggered sensors in:
  - main dashboard cards
  - overlay rows/groups
  - web monitor rows
- Added `Disable glow effects` appearance toggle to globally remove glow/shadow effects across desktop and web monitor UI.

### Changed
- Expanded web monitor settings model to persist auth token requirement and API-only mode.
- Updated `Open in Browser` behavior to include token query when token auth is enabled.
- Updated web monitor status text to indicate API-only runtime mode.
- Updated README documentation for profiles and web monitor security options.
- Updated Sensor Alerts UX with clearer field labeling and enabled-rule indicators.
- Updated Discord Rich Presence state text to show running app version as `vX.X.X`.
- Removed the clickable web monitor URL text line from Connectivity (kept `Open in Browser` button).
- Expanded dashboard card resizing support to include Summary Mode card width/height adjustments.
- Increased dashboard width-resize granularity with tighter snap behavior and finer grid minimum sizing.
- Reworked web monitor header controls so browser-open action is integrated into the existing `Web` toggle button.
- Updated web monitor dashboard layout density so browser cards use single-span layout and better match desktop per-row packing.
- Updated web monitor header branding icon source to higher-quality PNG rendering.
- Updated card width persistence to store effective pixel width for better cross-view mapping.

### Fixed
- Fixed a startup initialization regression that could prevent telemetry rendering after profile feature integration.
- Fixed profile rename flow by moving to explicit input-based rename behavior.
- Fixed settings temperature unit display mojibake (`Â°C` / `Â°F` -> `°C` / `°F`).
- Fixed web monitor layout over-spanning by mapping desktop card widths to web spans instead of using raw desktop span values.
- Fixed missing web monitor tab favicon by restoring explicit favicon/shortcut icon links with ICO-first fallback.

## 1.2.4 - 2026-05-12

### Added
- Added an auto-check-for-updates toggle in settings so update checks can be enabled/disabled by preference.
- Added configurable startup delay support with user-selected delay time before monitor initialization.
- Expanded the Setup Guide with more in-depth onboarding content and clearer setup instructions.
- Added `Overlay Category Order` controls in Overlay Settings with drag-and-drop ordering and reset-to-default support.

### Changed
- Updated webview ping labeling to use `Ping` terminology consistently instead of `Latency`.
- Enhanced Setup Guide dropdown hover styling with glow feedback for better visual affordance.
- Added an outer glow treatment to category windows and their contained settings sections for stronger visual grouping.
- Improved settings sidebar header branding mark (larger icon with reduced internal empty space) for clearer visual balance.
- Updated Overlay Settings structure to use the same full accordion section behavior as the rest of the settings UI.
- Extended settings export/import coverage to include overlay category ordering preferences.
- Added a focused desktop performance pass to reduce renderer CPU usage:
  - cached overlay category order in-memory instead of repeated per-tick `localStorage` reads
  - skipped web payload rebuild work while Web Monitor is not running
  - precomputed sensor display labels/formatted values once per update cycle for reuse in render/signature paths
  - cached active temperature unit in-memory for hot-path value normalization

### Fixed
- Fixed webview ping status icon rendering so it no longer appears as a plain green dot and now reflects the intended ping icon behavior.
- Fixed Overlay Settings dropdown arrow/toggle behavior and partial container rendering mismatch in the On-Screen Overlay section.
- Added clearer drag insertion indicators for overlay category reordering (before/after drop target lines) to make placement intent visible while dragging.
- Fixed an app termination edge case where the overlay could remain active after the main app closed by explicitly shutting down overlay window/hotkey during quit/close lifecycle hooks.

## 1.2.3 - 2026-05-12

### Added
- Added a dedicated `Ping` sensor group (main UI + overlay) with live metrics:
  - Current
  - Average
  - Minimum
  - Maximum
  - Packet Loss
- Added `Latency Host` setting to configure the target used for ping sampling.
- Added per-category overlay line-limit controls (FPS/CPU/GPU/RAM/PSU/Fans/Network/Ping/Drives/Other).
- Added an `Advanced` toggle to show/hide per-category overlay line-limit controls.
- Added broad tooltip coverage across settings and key header controls to improve discoverability.
- Added top-level collapsible dropdowns for main settings categories:
  - Appearance
  - Monitoring
  - Backup / Restore
  - Data Sources
  - Connectivity
  - App Behavior

### Changed
- Renamed `Latency` presentation labels to `Ping` across the main UI and overlay.
- Reworked overlay grouped-line rendering to support per-category line limits.
- Refined overlay grouped-line layout/alignment so single-line and multi-line group displays are consistently aligned.
- Reworked settings visual hierarchy from a heavy accordion stack toward a cleaner tree-like structure.
- Improved settings spacing and transition behavior for smoother expansion/collapse at both group and section levels.
- Enhanced hover styling for select dropdowns with accent glow feedback.
- Improved overlay per-category limit layout and responsiveness for better readability.
- Increased main dashboard panel width-resize granularity (finer horizontal resizing steps).
- Added panel width snapping with tuned step sizing for cleaner drag control.
- Reworked Setup Guide modal into icon-based dropdown sections for cleaner onboarding flow.
- Updated README documentation for Ping group support and overlay/ping settings additions.
- Finalized panel width resize behavior so cards reflow neighbors (no overlap) while keeping finer drag control.

### Fixed
- Fixed overlay grouped-line misalignment when line limits were set to 1.
- Fixed settings panel overlap/crowding issues in per-category overlay limit controls.
- Fixed sensor order drift when providers (notably AIDA) expose sensors late by preserving saved order entries instead of pruning missing sensors immediately.

### Backup / Export
- Updated settings export coverage to include newer overlay and ping-related settings, including:
  - per-category overlay line limits
  - advanced line-limit panel expanded/collapsed state
  - ping host target setting

## 1.2.2 - 2026-05-11

### Added
- Added overlay position unlock mode (`Unlock overlay position`) so the overlay can be temporarily dragged and repositioned.
- Added persisted custom overlay coordinates so dragged overlay position is restored.

### Changed
- Reorganized the Overlay Settings `Other` section into a cleaner layout (hotkey row + compact toggle cards).
- Restored and expanded README structure with full Table of Contents and current feature documentation.
- Updated setup/network guidance to clarify `0.0.0.0` can allow WAN/public exposure depending on firewall/router/public networking.

### Fixed
- Fixed setup/update/import modal close glyph rendering to display a proper `×` instead of mojibake.
- Fixed overlay grouped-line vertical text alignment so value text better matches label baseline.


## 1.2.1 - 2026-05-11

### Added
- Added a dedicated `FPS` sensor group card in the main dashboard, including FPS and Frame Time as first-class sensors.
- Added `FPS` visibility toggle under Visible Sensors so the FPS panel can be shown/hidden like CPU/GPU/RAM groups.
- Added robust global overlay hotkey support with broader key capture and accelerator fallbacks (including harder combinations and numpad variants).
- Added `NET` short label behavior for Network group title in overlay grouped-line mode.
- Added NSIS installer detail patch workflow and `dist:win` build path to improve installer detail output reliability.

### Changed
- Reworked RTSS shared-memory parsing to read real app entries and select actively updating sources, improving FPS/Frame Time correctness.
- Updated frame-time merge behavior to avoid stale/latching provider values and prefer live-derived values when needed.
- Improved grouped-line overlay readability with separators between values and adjusted spacing to reduce value collisions.
- Tightened overlay screen-edge positioning (top/left) to reduce offset from display edges.
- Refined overlay hotkey registration paths and startup registration behavior.
- Reorganized Overlay Settings UI:
  - Replaced overlay font-size dropdown with a slider.
  - Moved overlay font style controls into Overlay Settings.
  - Improved option alignment and consistency across overlay controls.
- Removed the Detection Mode dropdown from Settings (shared-memory mode is now implicit/fixed).
- Added a dedicated header Setup Guide button next to the Settings gear for faster access.
- Refreshed Setup Guide copy and visual styling to match the current UI language and layout.

### Fixed
- Fixed frame-time freezing behavior after RTSS launch in debug/live paths.
- Fixed provider/source handling so FPS and Frame Time paths behave consistently with source selection.
- Fixed overlay toggle hotkey state synchronization and re-enable behavior.
- Fixed multiple key-capture normalization issues that caused unreliable hotkey registration.
- Fixed installer build failure caused by invalid `beforePack` hook wiring.
- Fixed installer detail panel scripting pipeline so NSIS detail output hooks are correctly injected during packaging.
- Fixed overlay sensor row alignment when `Font Size` and `Unit Scale` differ, so names and values stay visually aligned.

### Removed
- Removed debug toggle/button and debug panel from the main UI.
- Removed AFMF compatibility toggle from overlay settings after review.

## 1.2.0 - 2026-05-7

### Added New Features
- Overlay System — Added a persistent, always‑on‑top transparent overlay for real‑time sensor display.
- Enable/Disable Toggle — Users can now activate or deactivate the overlay with a single checkbox.
- Font Controls — Introduced font size presets (including X‑Large), font family selection, and optional bold styling.
- Position Selector — Overlay can now be anchored to screen corners, including Top Left.
- Style Modes — Added “Grouped line” display mode for structured sensor grouping.
- Hotkey Support — Early implementation of a toggle hotkey (WIP, Doesn't Function Yet!).
- Monitor Selection — Users can choose which display the overlay appears on.

### Added Customization Improvements
- Group Spacing Slider — Fine‑tune spacing between grouped sensor lines.
- Unit Scale Slider — Adjust scaling of measurement units for readability.
- Background Opacity — Smooth slider for transparency control.
- Show Units Toggle — Optional display of measurement units.

### Added Visual Enhancements
- Text Color Picker — Choose custom text color.
- Value Color Picker — Separate color control for numeric values.
- Background Color Picker — Customize overlay background tint.

### Added General Improvements
- Instant Apply — All overlay changes now apply immediately without restarting the app.
- Sensor Integration — Overlay automatically uses the user’s selected sensors for display.

## 1.1.9 - 2026-04-26

### Added
- Added a full visual overhaul for the Settings sidebar with cleaner section hierarchy, richer spacing, and theme-aware control styling.
- Added per-style selection buttons in Appearance so each visual mode can be chosen directly.
- Added themed header action styling so `Summary Mode`, `Web`, `Discord`, and the settings gear share a matching control treatment.
- Added icons to the `Summary Mode` header control and active-state feedback when summary mode is enabled.

### Changed
- Reorganized the Settings panel into a more polished control-panel layout while preserving existing functionality and saved settings behavior.
- Improved preset theme colors so the built-in theme palette appears more saturated and closer to the intended color names.
- Updated theme switching so theme-driven custom colors refresh correctly when changing presets.
- Reworked style selection from a text-based cycle action into direct buttons for `Classic`, `Neon`, `Minimal`, and `Terminal`.
- Improved dropdown/select styling to better match the app theme and remain readable against the dark UI.
- Adjusted Sensor Selection category layout to a single-column flow to avoid overlap issues while expanding groups.
- Adjusted Discord recoonect and activity interval down to 5 seconds from 15 seconds, this should help it re-register in the event of a disconnect or toggle.

### Removed
- Removed the `Glass` theme and its related code paths.
- Removed the temporary settings overview strip from the redesigned sidebar after review.

### Packaging
- Built Windows release artifacts for `1.1.9` under `V1.1.9` (NSIS installer, portable executable, blockmap, and `latest.yml`).



## 1.1.8 - 2026-04-04

### Added
- **Header Toggle Buttons**: Added clickable toggle buttons to the app header for quick access to Web Monitor and Discord Rich Presence features.
  - Web Monitor button shows "Web: Off" when disabled, and "Web: {host}:{port}" when running (green).
  - Discord button shows "Discord: Off" when disabled, "Discord: On" when enabled but disconnected, and "Discord: On" (green) when connected.

### Changed
- **Cleaner Settings UI**: Removed the Discord presence status indicator pill from the Settings sidebar under Connectivity. Status is now displayed via the header toggle button instead.
- **Streamlined Web Monitor Toggle**: The Web Monitor toggle button in the header provides quick on/off access to the Web Monitor feature.

### Packaging
- Release packaging for v1.1.8: artifacts produced under `dist_release_118` (NSIS installer, portable executable, and blockmap).



## 1.1.5 - 2026-03-11
### Added
- Export / Import settings with a simplified import flow and a Backup & Restore option.
- Embedded the SiR icon as the Web Monitor favicon and improved web monitor metadata.
- Scrollable release notes area in the in-app updater dialog.

### Changed
- Replaced the textual `Monitoring Mode` header button with a compact settings gear icon that opens/closes the Settings sidebar and swapped the header action order so `Summary Mode` appears before Settings.
- Removed `Low Overhead Mode` and cleaned up related code paths (summary population now runs continuously in normal mode).
- Renamed the Web Monitor small indicator from `Live` to `Sharing` for clarity when publishing the web view.

### UI
- Removed the Import modal preview and tightened modal footer button spacing.
- Reduced spacing between the update prompt and the changelog box; changelog content is now contained in a scrollable area.

### Packaging
- Release packaging for v1.1.5: artifacts produced under `dist_release_115` (NSIS installer, portable executable, and blockmap).

### Fixed
- Prevented new installs from auto-launching in Summary Mode (defaults to Monitoring).
- Removed unintended bar/graph icon next to the header app icon.
- Ensured packaged Windows icon uses the circle `SiR_SM_Circle.ico` asset.

## 1.1.4 - 2026-03-08

### Added
- Settings → Connectivity: Discord Rich Presence dropdown allowing users to enable or disable Rich Presence without uninstalling the app.

### Changed
- Discord Rich Presence implemented using an in-repo IPC helper to avoid native build dependencies; presence is disabled immediately when turned off in settings.


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
  - Glass
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
