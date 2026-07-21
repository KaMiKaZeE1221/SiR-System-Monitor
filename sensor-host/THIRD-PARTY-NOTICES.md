# Sensor host third-party notices

The hardware sensor paths use LibreHardwareMonitorLib 0.9.6 and its bundled HidSharp dependency.

- Project: https://github.com/LibreHardwareMonitor/LibreHardwareMonitor
- License: Mozilla Public License 2.0
- Release archive SHA-256: `086D9F1B5A99E643EDC2CFAAAC16051685B551E4C5AC0B32A57C58C0E529C001`

LibreHardwareMonitor includes components under additional licenses. The authoritative notices are maintained in the upstream repository:

https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/blob/master/THIRD-PARTY-LICENSES.txt

The direct digital PSU readers are original telemetry-only implementations based on publicly documented USB/PMBus protocol behavior. The primary technical references and supported USB IDs are listed in `HARDWARE-SUPPORT.md`; no liquidctl or Linux kernel code is bundled with the app.
