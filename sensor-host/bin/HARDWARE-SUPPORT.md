# Native hardware sensor coverage

The device registry is protocol-aware: a USB vendor/product ID is only enabled when the native host implements that device family's wire protocol. PSU access is telemetry-only. The readers never change fan mode, over-current protection, rail configuration, or other PSU settings.

## Direct digital PSU telemetry

These devices can be read by the bundled native host without AIDA64, HWiNFO, Thermaltake DPS G, Corsair iCUE, or NZXT CAM.

| Protocol family | USB VID:PID | Model/family |
|---|---:|---|
| Thermaltake DPS HID | `264A:2329` | Thermaltake DPS/iRGB USB PSUs (model is queried from the device) |
| Corsair HID/PMBus | `1B1C:1C03` | HX550i |
| Corsair HID/PMBus | `1B1C:1C04` | HX650i |
| Corsair HID/PMBus | `1B1C:1C05` | HX750i |
| Corsair HID/PMBus | `1B1C:1C06` | HX850i |
| Corsair HID/PMBus | `1B1C:1C07` | HX1000i (legacy) |
| Corsair HID/PMBus | `1B1C:1C08` | HX1200i (legacy) |
| Corsair HID/PMBus | `1B1C:1C09` | RM550i |
| Corsair HID/PMBus | `1B1C:1C0A` | RM650i |
| Corsair HID/PMBus | `1B1C:1C0B` | RM750i |
| Corsair HID/PMBus | `1B1C:1C0C` | RM850i |
| Corsair HID/PMBus | `1B1C:1C0D` | RM1000i |
| Corsair HID/PMBus | `1B1C:1C1E` | HX1000i (2023) |
| Corsair HID/PMBus | `1B1C:1C1F` | HX1500i |
| Corsair HID/PMBus | `1B1C:1C23` | HX1200i (2023/ATX 3.1) |
| Corsair HID/PMBus | `1B1C:1C27` | HX1200i (2025/ATX 3.1) |
| NZXT E/Seasonic PMBus bridge | `7793:5911` | NZXT E500 |
| NZXT E/Seasonic PMBus bridge | `7793:5912` | NZXT E650 |
| NZXT E/Seasonic PMBus bridge | `7793:2500` | NZXT E850 |

Corsair AX1500i (`1B1C:1C02`) and AX1600i (`1B1C:1C11`) are intentionally not included. They use a different USB carrier protocol and must not be queried as HXi/RMi devices.

## Common hardware through Enhanced Hardware Sensors

The bundled LibreHardwareMonitor 0.9.6 backend covers common Intel/AMD CPUs, NVIDIA/AMD/Intel GPUs, SATA/NVMe/SMART storage, motherboard Super I/O and embedded controllers, plus these USB/controller families:

- Corsair and MSI digital PSUs
- Aquacomputer Aquastream, D5 Next, Farbwerk, Farbwerk 360, High Flow Next, MPS, Octo and Quadro
- NZXT Grid V3 and Kraken V2/V3
- Arctic fan controllers
- MSI CoreLiquid
- AeroCool P7-H1
- Razer fan controllers
- T-Balancer and Heatmaster

Enhanced mode can require administrator privileges for low-level motherboard and controller access. Intel CPU package-power domains use LibreHardwareMonitor's RAPL implementation and the bundled PawnIO driver; SiR offers to install or update that driver only after the user enables Enhanced Hardware Sensors or explicitly presses the driver-install button. RAPL domains vary by processor and platform: SiR publishes Package, Cores, Memory/DRAM, and Platform/PSys power only after the corresponding energy counter produces a valid reading, rather than displaying unsupported domains as permanent `0 W` sensors. Direct PSU readers remain available in standard mode where Windows permits the HID interface to be opened.

## Vendor-neutral FPS and frame time

The native sensor host bundles the signed Intel PresentMon 2.4.1 console collector and consumes Windows ETW presentation events. This provides `Native FPS` and `Native Frame Time` sensors for AMD, NVIDIA, and Intel GPUs across DirectX, OpenGL, and Vulkan applications without installing PresentMon, RTSS, or a vendor monitoring application. SiR detects installed GPU vendors automatically, prefers displayed-frame timing on AMD (including Fluid Motion Frames), falls back to presented-frame timing whenever displayed timing is unavailable, and keeps the lower-overhead presented-frame path for NVIDIA and other adapters. It targets the foreground rendering process, retains the last active game while the dashboard has focus, and disables GPU-duration and input tracking. Capture sessions are stopped cleanly, and abandoned SiR trace sessions from interrupted older builds are recovered before a new capture starts.

## Protocol and ID references

- Linux kernel Corsair PSU hwmon driver: https://github.com/torvalds/linux/blob/master/drivers/hwmon/corsair-psu.c
- liquidctl Corsair HID PSU driver: https://github.com/liquidctl/liquidctl/blob/main/liquidctl/driver/corsair_hid_psu.py
- liquidctl NZXT E-series PSU driver: https://github.com/liquidctl/liquidctl/blob/main/liquidctl/driver/nzxt_epsu.py
- PMBus command/encoding reference used by liquidctl: https://github.com/liquidctl/liquidctl/blob/main/liquidctl/pmbus.py
- Thermaltake DPS protocol notes: https://moshimoshi0.github.io/ttrgbplusapi/controllers/dpsg.html
- LibreHardwareMonitor controller implementations: https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/tree/master/LibreHardwareMonitorLib/Hardware/Controller
- LibreHardwareMonitor PSU implementations: https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/tree/master/LibreHardwareMonitorLib/Hardware/Psu
