using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using HidSharp;

namespace SiR.SensorHost
{
    internal sealed class PsuRailSnapshot
    {
        public string Id;
        public string Label;
        public double Voltage;
        public double Current;
        public double Power;
    }

    internal sealed class DigitalPsuSnapshot
    {
        public string Protocol;
        public string Model;
        public string UsbId;
        public double? InputVoltage;
        public double? InputCurrent;
        public double? Temperature1;
        public double? Temperature2;
        public double? FanRpm;
        public double? TotalOutputPower;
        public readonly List<PsuRailSnapshot> Rails = new List<PsuRailSnapshot>();
    }

    internal static class PsuProtocolMath
    {
        public static double DecodeLinear11(byte low, byte high)
        {
            int raw = low | (high << 8);
            int exponent = SignExtend((raw >> 11) & 0x1F, 5);
            int mantissa = SignExtend(raw & 0x7FF, 11);
            return mantissa * Math.Pow(2.0, exponent);
        }

        public static double DecodeUnsignedLinear16(byte low, byte high, byte voutMode)
        {
            int mantissa = low | (high << 8);
            int exponent = SignExtend(voutMode & 0x1F, 5);
            return mantissa * Math.Pow(2.0, exponent);
        }

        private static int SignExtend(int value, int bits)
        {
            int signBit = 1 << (bits - 1);
            int mask = (1 << bits) - 1;
            value &= mask;
            return (value & signBit) == 0 ? value : value - (1 << bits);
        }

        public static void Validate()
        {
            double linear11 = DecodeLinear11(0x67, 0xE3);
            double linear16 = DecodeUnsignedLinear16(0x67, 0x03, 0x1C);
            if (Math.Abs(linear11 - 54.4375) > 0.000001 || Math.Abs(linear16 - 54.4375) > 0.000001)
                throw new InvalidOperationException("PMBus numeric decoding self-test failed.");
        }
    }

    internal abstract class HidPsuReaderBase : IDisposable
    {
        private readonly object _sync = new object();
        private DateTime _nextOpenAttempt = DateTime.MinValue;
        private DateTime _lastReadAt = DateTime.MinValue;
        private DigitalPsuSnapshot _lastSnapshot;
        private bool _disposed;

        protected HidStream Stream;
        protected HidDevice Device;
        protected UsbHardwareDefinition Definition;
        protected int InputReportLength = 65;
        protected int OutputReportLength = 65;

        public bool IsActive
        {
            get { lock (_sync) { return Stream != null || (_lastSnapshot != null && (DateTime.UtcNow - _lastReadAt).TotalSeconds <= 5); } }
        }

        public DigitalPsuSnapshot ReadSnapshot()
        {
            lock (_sync)
            {
                if (_disposed) return null;
                DateTime now = DateTime.UtcNow;
                if (_lastSnapshot != null && (now - _lastReadAt).TotalMilliseconds < 750)
                    return _lastSnapshot;

                if (Stream == null && !TryOpen(now)) return null;

                try
                {
                    DigitalPsuSnapshot snapshot = ReadDeviceSnapshot();
                    ValidateSnapshot(snapshot);
                    _lastSnapshot = snapshot;
                    _lastReadAt = now;
                    return snapshot;
                }
                catch
                {
                    CloseStream();
                    _nextOpenAttempt = now.AddSeconds(10);
                    if (_lastSnapshot != null && (now - _lastReadAt).TotalSeconds <= 5)
                        return _lastSnapshot;
                    return null;
                }
            }
        }

        protected abstract IEnumerable<UsbHardwareDefinition> SupportedDevices { get; }
        protected abstract void InitializeDevice();
        protected abstract DigitalPsuSnapshot ReadDeviceSnapshot();

        private bool TryOpen(DateTime now)
        {
            if (now < _nextOpenAttempt) return false;
            _nextOpenAttempt = now.AddSeconds(10);

            UsbHardwareDefinition[] definitions = SupportedDevices.ToArray();
            HashSet<int> vendorIds = new HashSet<int>(definitions.Select(definition => definition.VendorId));
            IEnumerable<HidDevice> candidates;
            try
            {
                candidates = DeviceList.Local.GetHidDevices().Where(device => vendorIds.Contains(device.VendorID)).ToArray();
            }
            catch
            {
                return false;
            }

            foreach (HidDevice device in candidates)
            {
                UsbHardwareDefinition definition = HardwareDeviceCatalog.Find(definitions, device.VendorID, device.ProductID);
                if (definition == null) continue;

                HidStream stream = null;
                try
                {
                    if (!device.TryOpen(out stream) || stream == null) continue;
                    stream.ReadTimeout = 800;
                    stream.WriteTimeout = 800;
                    Stream = stream;
                    Device = device;
                    Definition = definition;
                    InputReportLength = Math.Max(8, device.GetMaxInputReportLength());
                    OutputReportLength = Math.Max(8, device.GetMaxOutputReportLength());
                    InitializeDevice();
                    return true;
                }
                catch
                {
                    if (stream != null)
                    {
                        try { stream.Dispose(); } catch { }
                    }
                    Stream = null;
                    Device = null;
                    Definition = null;
                }
            }
            return false;
        }

        protected static void ValidateSnapshot(DigitalPsuSnapshot snapshot)
        {
            if (snapshot == null || String.IsNullOrWhiteSpace(snapshot.Model) || snapshot.Rails.Count == 0)
                throw new InvalidDataException("Digital PSU returned an incomplete snapshot.");

            ValidateOptional(snapshot.InputVoltage, 0, 350, "input voltage");
            ValidateOptional(snapshot.InputCurrent, 0, 50, "input current");
            ValidateOptional(snapshot.Temperature1, -20, 150, "temperature");
            ValidateOptional(snapshot.Temperature2, -20, 150, "temperature");
            ValidateOptional(snapshot.FanRpm, 0, 10000, "fan speed");
            ValidateOptional(snapshot.TotalOutputPower, 0, 3000, "output power");

            foreach (PsuRailSnapshot rail in snapshot.Rails)
            {
                if (rail == null || String.IsNullOrWhiteSpace(rail.Id) || String.IsNullOrWhiteSpace(rail.Label) ||
                    Double.IsNaN(rail.Voltage) || Double.IsInfinity(rail.Voltage) || rail.Voltage < 0 || rail.Voltage > 20 ||
                    Double.IsNaN(rail.Current) || Double.IsInfinity(rail.Current) || rail.Current < 0 || rail.Current > 250 ||
                    Double.IsNaN(rail.Power) || Double.IsInfinity(rail.Power) || rail.Power < 0 || rail.Power > 3000)
                    throw new InvalidDataException("Digital PSU returned an implausible rail value.");
            }
        }

        private static void ValidateOptional(double? value, double minimum, double maximum, string name)
        {
            if (!value.HasValue) return;
            if (Double.IsNaN(value.Value) || Double.IsInfinity(value.Value) || value.Value < minimum || value.Value > maximum)
                throw new InvalidDataException("Digital PSU returned an implausible " + name + ".");
        }

        protected void CloseStream()
        {
            HidStream stream = Stream;
            Stream = null;
            Device = null;
            Definition = null;
            if (stream != null)
            {
                try { stream.Dispose(); } catch { }
            }
        }

        public void Dispose()
        {
            lock (_sync)
            {
                _disposed = true;
                CloseStream();
            }
        }
    }

    internal sealed class CorsairHidPsuReader : HidPsuReaderBase
    {
        private const byte ReadAddress = 0x03;
        private const byte SelectRailCommand = 0x00;
        private const byte ReadInputVoltage = 0x88;
        private const byte ReadInputCurrent = 0x89;
        private const byte ReadOutputVoltage = 0x8B;
        private const byte ReadOutputCurrent = 0x8C;
        private const byte ReadTemperature1 = 0x8D;
        private const byte ReadTemperature2 = 0x8E;
        private const byte ReadFanSpeed = 0x90;
        private const byte ReadOutputPower = 0x96;
        private const byte ReadTotalOutputPower = 0xEE;

        protected override IEnumerable<UsbHardwareDefinition> SupportedDevices
        {
            get { return HardwareDeviceCatalog.CorsairHidPsus; }
        }

        protected override void InitializeDevice()
        {
            // This is the vendor-defined wake/init request used by the read-only hwmon
            // path. No fan, OCP, rail-mode or other configuration command is sent.
            Exchange(new byte[] { 0xFE, 0x03, 0x00 });
        }

        protected override DigitalPsuSnapshot ReadDeviceSnapshot()
        {
            DigitalPsuSnapshot snapshot = new DigitalPsuSnapshot
            {
                Protocol = Definition.Protocol,
                Model = Definition.Name,
                UsbId = Definition.UsbId,
                InputVoltage = ReadLinear11(ReadInputVoltage),
                InputCurrent = ReadLinear11(ReadInputCurrent),
                Temperature1 = ReadLinear11(ReadTemperature1),
                Temperature2 = ReadLinear11(ReadTemperature2),
                FanRpm = ReadLinear11(ReadFanSpeed),
                TotalOutputPower = ReadLinear11(ReadTotalOutputPower)
            };

            AddRail(snapshot, 0, "12v", "+12V");
            AddRail(snapshot, 1, "5v", "+5V");
            AddRail(snapshot, 2, "3v3", "+3.3V");
            return snapshot;
        }

        private void AddRail(DigitalPsuSnapshot snapshot, byte railIndex, string id, string label)
        {
            SelectRail(railIndex);
            snapshot.Rails.Add(new PsuRailSnapshot
            {
                Id = id,
                Label = label,
                Voltage = ReadLinear11(ReadOutputVoltage),
                Current = ReadLinear11(ReadOutputCurrent),
                Power = ReadLinear11(ReadOutputPower)
            });
        }

        private void SelectRail(byte railIndex)
        {
            Exchange(new byte[] { 0x02, SelectRailCommand, railIndex });
        }

        private double ReadLinear11(byte command)
        {
            byte[] payload = Exchange(new byte[] { ReadAddress, command, 0x00 });
            if (payload.Length < 2)
                throw new InvalidDataException("Corsair PSU returned an incomplete PMBus value.");
            return PsuProtocolMath.DecodeLinear11(payload[0], payload[1]);
        }

        private byte[] Exchange(byte[] request)
        {
            if (Stream == null) throw new InvalidOperationException("Corsair PSU is not connected.");
            if (request == null || request.Length < 2) throw new ArgumentException("A Corsair request requires at least two bytes.", "request");

            byte[] output = new byte[Math.Max(OutputReportLength, request.Length + 1)];
            output[0] = 0;
            Buffer.BlockCopy(request, 0, output, 1, request.Length);
            Stream.Write(output);

            byte[] input = new byte[InputReportLength];
            int bytesRead = Stream.Read(input);
            int responseOffset = FindPrefix(input, bytesRead, request[0], request[1]);
            if (responseOffset < 0)
                throw new InvalidDataException("Unexpected Corsair PSU response.");

            int payloadOffset = responseOffset + 2;
            int payloadLength = Math.Max(0, bytesRead - payloadOffset);
            byte[] payload = new byte[payloadLength];
            Buffer.BlockCopy(input, payloadOffset, payload, 0, payloadLength);
            return payload;
        }

        private static int FindPrefix(byte[] input, int bytesRead, byte first, byte second)
        {
            if (bytesRead >= 2 && input[0] == first && input[1] == second) return 0;
            if (bytesRead >= 3 && input[1] == first && input[2] == second) return 1;
            return -1;
        }
    }

    internal sealed class NzxtEPsuReader : HidPsuReaderBase
    {
        private const byte BridgeRequest = 0xAD;
        private const byte BridgeResponse = 0xAA;
        private const byte PmbusAddress = 0x60;
        private const byte PagePlusRead = 0x06;
        private const byte VoutMode = 0x20;
        private const byte ReadOutputVoltage = 0x8B;
        private const byte ReadOutputCurrent = 0x8C;
        private const byte ReadTemperature2 = 0x8E;
        private const byte ReadFanSpeed1 = 0x90;
        private const byte ReadOutputPower = 0x96;
        private static readonly string[] RailLabels =
        {
            "+12V Peripherals",
            "+12V EPS/ATX12V",
            "+12V Motherboard/PCI-e",
            "+5V Combined",
            "+3.3V Combined"
        };

        private readonly Dictionary<byte, byte> _voutModes = new Dictionary<byte, byte>();

        protected override IEnumerable<UsbHardwareDefinition> SupportedDevices
        {
            get { return HardwareDeviceCatalog.NzxtEPsus; }
        }

        protected override void InitializeDevice()
        {
            _voutModes.Clear();
            // E-series devices do not require initialization; all requests below are reads.
        }

        protected override DigitalPsuSnapshot ReadDeviceSnapshot()
        {
            DigitalPsuSnapshot snapshot = new DigitalPsuSnapshot
            {
                Protocol = Definition.Protocol,
                Model = Definition.Name,
                UsbId = Definition.UsbId,
                Temperature1 = ReadLinear11(ReadTemperature2),
                FanRpm = ReadLinear11(ReadFanSpeed1)
            };

            double totalPower = 0;
            for (byte rail = 0; rail < RailLabels.Length; rail++)
            {
                PsuRailSnapshot railSnapshot = new PsuRailSnapshot
                {
                    Id = "rail" + (rail + 1),
                    Label = RailLabels[rail],
                    Voltage = ReadOutputVoltageForRail(rail),
                    Current = ReadLinear11(ReadOutputCurrent, rail),
                    Power = ReadLinear11(ReadOutputPower, rail)
                };
                snapshot.Rails.Add(railSnapshot);
                totalPower += railSnapshot.Power;
            }
            snapshot.TotalOutputPower = totalPower;
            return snapshot;
        }

        private double ReadOutputVoltageForRail(byte rail)
        {
            byte mode;
            if (!_voutModes.TryGetValue(rail, out mode))
            {
                byte[] modeData = ExecutePageRead(rail, VoutMode, 1);
                mode = modeData[0];
                if ((mode >> 5) != 0)
                    throw new InvalidDataException("NZXT E-series PSU returned an unsupported VOUT_MODE.");
                _voutModes[rail] = mode;
            }

            byte[] value = ExecutePageRead(rail, ReadOutputVoltage, 2);
            return PsuProtocolMath.DecodeUnsignedLinear16(value[0], value[1], mode);
        }

        private double ReadLinear11(byte command)
        {
            byte[] value = ExecuteRead(command, 2);
            return PsuProtocolMath.DecodeLinear11(value[0], value[1]);
        }

        private double ReadLinear11(byte command, byte rail)
        {
            byte[] value = ExecutePageRead(rail, command, 2);
            return PsuProtocolMath.DecodeLinear11(value[0], value[1]);
        }

        private byte[] ExecuteRead(byte command, int dataLength)
        {
            byte[] request =
            {
                BridgeRequest, 0x00, (byte)(dataLength + 1), 0x01, PmbusAddress, command
            };
            return ExecuteBridgeRequest(request, dataLength, false);
        }

        private byte[] ExecutePageRead(byte rail, byte command, int dataLength)
        {
            byte[] request =
            {
                BridgeRequest, 0x00, (byte)(dataLength + 2), 0x04, PmbusAddress,
                PagePlusRead, 0x02, rail, command
            };
            return ExecuteBridgeRequest(request, dataLength, true);
        }

        private byte[] ExecuteBridgeRequest(byte[] request, int dataLength, bool pageRead)
        {
            if (Stream == null) throw new InvalidOperationException("NZXT E-series PSU is not connected.");

            for (int attempt = 0; attempt < 3; attempt++)
            {
                // The bridge's PIC microcontroller needs a short scheduling gap between
                // commands; 3 ms is intentionally just above the observed 2.5 ms floor.
                Thread.Sleep(3);
                byte[] output = new byte[Math.Max(OutputReportLength, request.Length + 1)];
                output[0] = 0;
                Buffer.BlockCopy(request, 0, output, 1, request.Length);
                Stream.Write(output);

                byte[] input = new byte[InputReportLength];
                int bytesRead = Stream.Read(input);
                int offset = FindBridgeResponse(input, bytesRead);
                if (offset < 0) continue;

                int expectedLength = dataLength + (pageRead ? 2 : 1);
                if (bytesRead <= offset + 1 || input[offset + 1] != expectedLength) continue;
                int dataOffset;
                if (pageRead)
                {
                    if (bytesRead <= offset + 2 || input[offset + 2] != dataLength) continue;
                    dataOffset = offset + 3;
                }
                else
                {
                    dataOffset = offset + 2;
                }

                if (bytesRead < dataOffset + dataLength) continue;
                byte[] data = new byte[dataLength];
                Buffer.BlockCopy(input, dataOffset, data, 0, dataLength);
                return data;
            }

            throw new InvalidDataException("NZXT E-series PSU returned an invalid PMBus bridge response.");
        }

        private static int FindBridgeResponse(byte[] input, int bytesRead)
        {
            if (bytesRead >= 1 && input[0] == BridgeResponse) return 0;
            if (bytesRead >= 2 && input[1] == BridgeResponse) return 1;
            return -1;
        }
    }
}
