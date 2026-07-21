# Sensor host third-party notices

The hardware sensor paths use LibreHardwareMonitorLib 0.9.6 and its bundled HidSharp dependency.

- Project: https://github.com/LibreHardwareMonitor/LibreHardwareMonitor
- License: Mozilla Public License 2.0
- Release archive SHA-256: `086D9F1B5A99E643EDC2CFAAAC16051685B551E4C5AC0B32A57C58C0E529C001`

LibreHardwareMonitor includes components under additional licenses. The authoritative notices are maintained in the upstream repository:

https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/blob/master/THIRD-PARTY-LICENSES.txt

The enhanced-hardware package also includes the official PawnIO 2.2 driver installer embedded by LibreHardwareMonitor 0.9.6. SiR only runs it after the user explicitly enables enhanced low-level access or selects the driver repair action.

- Installer source: https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/blob/v0.9.6/LibreHardwareMonitor/Resources/PawnIO_setup.exe
- Packaged installer SHA-256: `A3A46226C5E2824F4CDD42BE0EECBABFC672C86F7889710F5AB1E6AD385B47A0`
- PawnIO project: https://github.com/namazso/PawnIO
- PawnIO modules and LGPL-2.1 notice: https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/tree/v0.9.6/LibreHardwareMonitorLib/Resources/PawnIo

The direct digital PSU readers are original telemetry-only implementations based on publicly documented USB/PMBus protocol behavior. The primary technical references and supported USB IDs are listed in `HARDWARE-SUPPORT.md`; no liquidctl or Linux kernel code is bundled with the app.

Vendor-neutral native FPS and frame-time capture uses the official Intel PresentMon 2.4.1 x64 console binary. It is bundled as a hidden sensor-host component and is not installed as a separate application or service. GPU-duration and input tracking remain disabled to reduce overhead; display-duration tracking is enabled automatically for AMD/hybrid presentation paths where displayed-frame timing is required.

- Project and source: https://github.com/GameTechDev/PresentMon
- Release: https://github.com/GameTechDev/PresentMon/releases/tag/v2.4.1
- License: MIT
- Packaged executable SHA-256: `D74183E7AE630F72CD3690BE0373ECBFDC6CBB86578148AAB8FA2A7166068F34`
- Publisher signature: Intel Corporation
