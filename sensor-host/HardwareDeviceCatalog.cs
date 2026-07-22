using System;
using System.Collections.Generic;
using System.Linq;

namespace SiR.SensorHost
{
    internal sealed class UsbHardwareDefinition
    {
        public UsbHardwareDefinition(int vendorId, int productId, string name, string protocol)
        {
            VendorId = vendorId;
            ProductId = productId;
            Name = name;
            Protocol = protocol;
        }

        public int VendorId { get; private set; }
        public int ProductId { get; private set; }
        public string Name { get; private set; }
        public string Protocol { get; private set; }

        public string UsbId
        {
            get { return VendorId.ToString("X4") + ":" + ProductId.ToString("X4"); }
        }
    }

    // Device IDs are deliberately grouped by wire protocol. A matching USB ID alone is
    // not enough to safely query a PSU; each group is paired with its own reader.
    internal static class HardwareDeviceCatalog
    {
        public const string ThermaltakeDpsProtocol = "thermaltake-dps-hid";
        public const string CorsairHidPsuProtocol = "corsair-hid-pmbus";
        public const string NzxtEPsuProtocol = "nzxt-e-seasonic-pmbus-bridge";

        public static readonly UsbHardwareDefinition[] ThermaltakeDpsPsus =
        {
            new UsbHardwareDefinition(0x264A, 0x2329, "Thermaltake DPS/iRGB PSU", ThermaltakeDpsProtocol)
        };

        public static readonly UsbHardwareDefinition[] CorsairHidPsus =
        {
            new UsbHardwareDefinition(0x1B1C, 0x1C03, "Corsair HX550i", CorsairHidPsuProtocol),
            new UsbHardwareDefinition(0x1B1C, 0x1C04, "Corsair HX650i", CorsairHidPsuProtocol),
            new UsbHardwareDefinition(0x1B1C, 0x1C05, "Corsair HX750i", CorsairHidPsuProtocol),
            new UsbHardwareDefinition(0x1B1C, 0x1C06, "Corsair HX850i", CorsairHidPsuProtocol),
            new UsbHardwareDefinition(0x1B1C, 0x1C07, "Corsair HX1000i (legacy)", CorsairHidPsuProtocol),
            new UsbHardwareDefinition(0x1B1C, 0x1C08, "Corsair HX1200i (legacy)", CorsairHidPsuProtocol),
            new UsbHardwareDefinition(0x1B1C, 0x1C09, "Corsair RM550i", CorsairHidPsuProtocol),
            new UsbHardwareDefinition(0x1B1C, 0x1C0A, "Corsair RM650i", CorsairHidPsuProtocol),
            new UsbHardwareDefinition(0x1B1C, 0x1C0B, "Corsair RM750i", CorsairHidPsuProtocol),
            new UsbHardwareDefinition(0x1B1C, 0x1C0C, "Corsair RM850i", CorsairHidPsuProtocol),
            new UsbHardwareDefinition(0x1B1C, 0x1C0D, "Corsair RM1000i", CorsairHidPsuProtocol),
            new UsbHardwareDefinition(0x1B1C, 0x1C1E, "Corsair HX1000i (2023)", CorsairHidPsuProtocol),
            new UsbHardwareDefinition(0x1B1C, 0x1C1F, "Corsair HX1500i", CorsairHidPsuProtocol),
            new UsbHardwareDefinition(0x1B1C, 0x1C23, "Corsair HX1200i (2023/ATX 3.1)", CorsairHidPsuProtocol),
            new UsbHardwareDefinition(0x1B1C, 0x1C27, "Corsair HX1200i (2025/ATX 3.1)", CorsairHidPsuProtocol)
        };

        public static readonly UsbHardwareDefinition[] NzxtEPsus =
        {
            new UsbHardwareDefinition(0x7793, 0x5911, "NZXT E500", NzxtEPsuProtocol),
            new UsbHardwareDefinition(0x7793, 0x5912, "NZXT E650", NzxtEPsuProtocol),
            new UsbHardwareDefinition(0x7793, 0x2500, "NZXT E850", NzxtEPsuProtocol)
        };

        // These families are supplied by the bundled LibreHardwareMonitor enhanced
        // backend. Keeping the list here makes the app's hardware coverage visible in
        // diagnostics without duplicating those mature protocol implementations.
        public static readonly string[] CommonEnhancedFamilies =
        {
            "Intel and AMD CPUs",
            "NVIDIA, AMD and Intel GPUs",
            "SATA, NVMe and SMART storage",
            "Motherboard Super I/O and embedded controllers",
            "Corsair digital PSUs",
            "MSI digital PSUs",
            "Aquacomputer Aquastream, D5 Next, Farbwerk, Farbwerk 360, High Flow Next, MPS, Octo and Quadro",
            "NZXT Grid V3 and Kraken V2/V3 controllers",
            "Arctic fan controllers",
            "MSI CoreLiquid controllers",
            "AeroCool P7-H1 controllers",
            "Razer fan controllers",
            "T-Balancer controllers",
            "Heatmaster controllers"
        };

        public static IEnumerable<UsbHardwareDefinition> DirectPsuDevices
        {
            get
            {
                return ThermaltakeDpsPsus
                    .Concat(CorsairHidPsus)
                    .Concat(NzxtEPsus);
            }
        }

        public static int DirectPsuDeviceIdCount
        {
            get { return DirectPsuDevices.Count(); }
        }

        public static int DirectPsuProtocolCount
        {
            get { return DirectPsuDevices.Select(device => device.Protocol).Distinct(StringComparer.Ordinal).Count(); }
        }

        public static UsbHardwareDefinition Find(IEnumerable<UsbHardwareDefinition> definitions, int vendorId, int productId)
        {
            return (definitions ?? Enumerable.Empty<UsbHardwareDefinition>()).FirstOrDefault(device =>
                device.VendorId == vendorId && device.ProductId == productId);
        }

        public static void Validate()
        {
            UsbHardwareDefinition[] devices = DirectPsuDevices.ToArray();
            string duplicate = devices
                .GroupBy(device => device.UsbId, StringComparer.OrdinalIgnoreCase)
                .Where(group => group.Count() > 1)
                .Select(group => group.Key)
                .FirstOrDefault();
            if (duplicate != null)
                throw new InvalidOperationException("Duplicate direct PSU USB ID in hardware catalog: " + duplicate);

            if (devices.Any(device => String.IsNullOrWhiteSpace(device.Name) || String.IsNullOrWhiteSpace(device.Protocol)))
                throw new InvalidOperationException("The direct PSU hardware catalog contains an incomplete definition.");
        }
    }
}
