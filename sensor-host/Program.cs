using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using HidSharp;
using LibreHardwareMonitor.Hardware;

namespace SiR.SensorHost
{
    internal sealed class SensorRecord
    {
        public string id { get; set; }
        public string name { get; set; }
        public object value { get; set; }
        public string units { get; set; }
        public string group { get; set; }
        public string provider { get; set; }
        public string hardwareType { get; set; }
        public string sensorType { get; set; }
        public bool defaultEnabled { get; set; }
    }

    internal sealed class Snapshot
    {
        public long timestamp { get; set; }
        public List<SensorRecord> sensors { get; set; }
        public Dictionary<string, object> diagnostics { get; set; }
    }

    internal sealed class UpdateVisitor : IVisitor
    {
        public void VisitComputer(IComputer computer)
        {
            computer.Traverse(this);
        }

        public void VisitHardware(IHardware hardware)
        {
            hardware.Update();
            foreach (IHardware subHardware in hardware.SubHardware)
                subHardware.Accept(this);
        }

        public void VisitSensor(ISensor sensor) { }
        public void VisitParameter(IParameter parameter) { }
    }

    internal sealed class CpuLoadSampler
    {
        private ulong _idle;
        private ulong _kernel;
        private ulong _user;
        private bool _hasPrevious;

        public double? Sample()
        {
            FileTime idleTime;
            FileTime kernelTime;
            FileTime userTime;
            if (!GetSystemTimes(out idleTime, out kernelTime, out userTime))
                return null;

            ulong idle = idleTime.ToUInt64();
            ulong kernel = kernelTime.ToUInt64();
            ulong user = userTime.ToUInt64();
            if (!_hasPrevious)
            {
                _idle = idle;
                _kernel = kernel;
                _user = user;
                _hasPrevious = true;
                return null;
            }

            ulong idleDelta = idle - _idle;
            ulong kernelDelta = kernel - _kernel;
            ulong userDelta = user - _user;
            ulong totalDelta = kernelDelta + userDelta;
            _idle = idle;
            _kernel = kernel;
            _user = user;

            if (totalDelta == 0)
                return null;

            double busy = 100.0 * (totalDelta - idleDelta) / totalDelta;
            return Math.Max(0.0, Math.Min(100.0, busy));
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct FileTime
        {
            public uint Low;
            public uint High;

            public ulong ToUInt64()
            {
                return ((ulong)High << 32) | Low;
            }
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetSystemTimes(out FileTime idleTime, out FileTime kernelTime, out FileTime userTime);
    }

    internal sealed class ThermaltakePsuSnapshot
    {
        public string Model;
        public double AcInputVoltage;
        public double Rail12Voltage;
        public double Rail5Voltage;
        public double Rail33Voltage;
        public double Rail12Current;
        public double Rail5Current;
        public double Rail33Current;
        public double Temperature;
        public double FanRpm;

        public double Rail12Power { get { return Rail12Voltage * Rail12Current; } }
        public double Rail5Power { get { return Rail5Voltage * Rail5Current; } }
        public double Rail33Power { get { return Rail33Voltage * Rail33Current; } }
        public double TotalOutputPower { get { return Rail12Power + Rail5Power + Rail33Power; } }
    }

    internal sealed class ThermaltakePsuReader : IDisposable
    {
        private const int VendorId = 0x264A;
        private const int ProductId = 0x2329;
        private readonly object _sync = new object();
        private HidStream _stream;
        private int _inputReportLength = 65;
        private int _outputReportLength = 65;
        private string _model = "Thermaltake DPS PSU";
        private DateTime _nextOpenAttempt = DateTime.MinValue;
        private DateTime _lastReadAt = DateTime.MinValue;
        private ThermaltakePsuSnapshot _lastSnapshot;
        private bool _disposed;

        public bool IsActive
        {
            get
            {
                lock (_sync)
                {
                    return _stream != null || (_lastSnapshot != null && (DateTime.UtcNow - _lastReadAt).TotalSeconds <= 5);
                }
            }
        }

        public ThermaltakePsuSnapshot ReadSnapshot()
        {
            lock (_sync)
            {
                if (_disposed) return null;
                DateTime now = DateTime.UtcNow;
                if (_lastSnapshot != null && (now - _lastReadAt).TotalMilliseconds < 750)
                    return _lastSnapshot;

                if (_stream == null && !TryOpen(now)) return null;

                try
                {
                    ThermaltakePsuSnapshot snapshot = new ThermaltakePsuSnapshot
                    {
                        Model = _model,
                        AcInputVoltage = ReadValue(0x31, 0x33),
                        Rail12Voltage = ReadValue(0x31, 0x34),
                        Rail5Voltage = ReadValue(0x31, 0x35),
                        Rail33Voltage = ReadValue(0x31, 0x36),
                        Rail12Current = ReadValue(0x31, 0x37),
                        Rail5Current = ReadValue(0x31, 0x38),
                        Rail33Current = ReadValue(0x31, 0x39),
                        Temperature = ReadValue(0x31, 0x3A),
                        FanRpm = ReadValue(0x31, 0x3B)
                    };

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

        private bool TryOpen(DateTime now)
        {
            if (now < _nextOpenAttempt) return false;
            _nextOpenAttempt = now.AddSeconds(10);

            foreach (HidDevice device in DeviceList.Local.GetHidDevices(VendorId, ProductId))
            {
                HidStream stream = null;
                try
                {
                    if (!device.TryOpen(out stream) || stream == null) continue;
                    stream.ReadTimeout = 800;
                    stream.WriteTimeout = 800;
                    _stream = stream;
                    _inputReportLength = Math.Max(5, device.GetMaxInputReportLength());
                    _outputReportLength = Math.Max(3, device.GetMaxOutputReportLength());
                    byte[] modelPayload = SendCommand(0xFE, 0x31);
                    string detectedModel = Encoding.ASCII.GetString(modelPayload).Trim('\0', ' ', '\r', '\n', '\t');
                    if (!String.IsNullOrWhiteSpace(detectedModel))
                        _model = "Thermaltake " + detectedModel;
                    return true;
                }
                catch
                {
                    if (stream != null)
                    {
                        try { stream.Dispose(); } catch { }
                    }
                    _stream = null;
                }
            }
            return false;
        }

        private byte[] SendCommand(byte first, byte second)
        {
            if (_stream == null) throw new InvalidOperationException("Thermaltake PSU is not connected.");

            byte[] output = new byte[_outputReportLength];
            output[0] = 0;
            output[1] = first;
            output[2] = second;
            _stream.Write(output);

            byte[] input = new byte[_inputReportLength];
            int bytesRead = _stream.Read(input);
            int commandOffset = bytesRead >= 2 && input[0] == first && input[1] == second
                ? 0
                : (bytesRead >= 3 && input[1] == first && input[2] == second ? 1 : -1);
            if (commandOffset < 0)
                throw new InvalidDataException("Unexpected Thermaltake PSU response.");

            int payloadOffset = commandOffset + 2;
            int payloadLength = Math.Max(0, bytesRead - payloadOffset);
            byte[] payload = new byte[payloadLength];
            Buffer.BlockCopy(input, payloadOffset, payload, 0, payloadLength);
            return payload;
        }

        private double ReadValue(byte first, byte second)
        {
            byte[] payload = SendCommand(first, second);
            if (payload.Length < 2) throw new InvalidDataException("Thermaltake PSU returned an incomplete value.");

            int raw = (payload[1] << 8) | payload[0];
            int exponent = (raw & 0x7800) >> 11;
            if ((raw & 0x8000) != 0) exponent -= 16;
            int fraction = raw & 0x07FF;
            return Math.Pow(2.0, exponent) * fraction;
        }

        private static void ValidateSnapshot(ThermaltakePsuSnapshot snapshot)
        {
            if (snapshot.AcInputVoltage < 50 || snapshot.AcInputVoltage > 300 ||
                snapshot.Rail12Voltage < 0 || snapshot.Rail12Voltage > 20 ||
                snapshot.Rail5Voltage < 0 || snapshot.Rail5Voltage > 10 ||
                snapshot.Rail33Voltage < 0 || snapshot.Rail33Voltage > 7 ||
                snapshot.Rail12Current < 0 || snapshot.Rail12Current > 250 ||
                snapshot.Rail5Current < 0 || snapshot.Rail5Current > 100 ||
                snapshot.Rail33Current < 0 || snapshot.Rail33Current > 100 ||
                snapshot.Temperature < -20 || snapshot.Temperature > 150 ||
                snapshot.FanRpm < 0 || snapshot.FanRpm > 10000 ||
                snapshot.TotalOutputPower < 0 || snapshot.TotalOutputPower > 3000)
                throw new InvalidDataException("Thermaltake PSU returned an implausible sensor value.");
        }

        private void CloseStream()
        {
            HidStream stream = _stream;
            _stream = null;
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

    internal sealed class SensorCollector : IDisposable
    {
        private const double DirectPsuSnapshotRetentionSeconds = 15;
        private readonly bool _enhancedRequested;
        private readonly object _enhancedSync = new object();
        private readonly CpuLoadSampler _cpuLoad = new CpuLoadSampler();
        private readonly ThermaltakePsuReader _thermaltakePsu = new ThermaltakePsuReader();
        private readonly CorsairHidPsuReader _corsairPsu = new CorsairHidPsuReader();
        private readonly NzxtEPsuReader _nzxtEPsu = new NzxtEPsuReader();
        private readonly PresentMonFpsReader _presentMonFps = new PresentMonFpsReader();
        private readonly object _directPsuSync = new object();
        private readonly Dictionary<string, NetworkSample> _networkSamples = new Dictionary<string, NetworkSample>();
        private readonly HashSet<string> _validatedCpuPowerSensorIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private readonly HashSet<string> _unavailableCpuPowerDomains = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private readonly UpdateVisitor _updateVisitor = new UpdateVisitor();
        private PerformanceCounter _memoryReadActivity;
        private PerformanceCounter _memoryWriteActivity;
        private List<SensorRecord> _cachedDriveSensors = new List<SensorRecord>();
        private DateTime _lastDriveSample = DateTime.MinValue;
        private Computer _processorComputer;
        private Computer _graphicsComputer;
        private Computer _boardComputer;
        private Computer _peripheralComputer;
        private ThermaltakePsuSnapshot _thermaltakePsuSnapshot;
        private DigitalPsuSnapshot _corsairPsuSnapshot;
        private DigitalPsuSnapshot _nzxtPsuSnapshot;
        private DateTime _thermaltakePsuSnapshotAt = DateTime.MinValue;
        private DateTime _corsairPsuSnapshotAt = DateTime.MinValue;
        private DateTime _nzxtPsuSnapshotAt = DateTime.MinValue;
        private bool _thermaltakePsuPollRunning;
        private bool _corsairPsuPollRunning;
        private bool _nzxtPsuPollRunning;
        private DateTime _nextThermaltakePsuPoll = DateTime.MinValue;
        private DateTime _nextCorsairPsuPoll = DateTime.MinValue;
        private DateTime _nextNzxtPsuPoll = DateTime.MinValue;
        private string _enhancedWarning;
        private bool _enhancedProcessorInitializing;
        private bool _enhancedGraphicsInitializing;
        private bool _enhancedBoardInitializing;
        private bool _enhancedPeripheralInitializing;
        private bool _remainingEnhancedPhasesQueued;
        private readonly bool _hardwareAccessDriverInstalled;
        private readonly string _hardwareAccessDriverVersion;
        private volatile bool _disposed;

        public SensorCollector(bool enhancedRequested)
        {
            _enhancedRequested = enhancedRequested;
            HardwareDeviceCatalog.Validate();
            PsuProtocolMath.Validate();
            try
            {
                _hardwareAccessDriverInstalled = LibreHardwareMonitor.PawnIo.PawnIo.IsInstalled;
                Version driverVersion = LibreHardwareMonitor.PawnIo.PawnIo.Version;
                _hardwareAccessDriverVersion = driverVersion == null ? "" : driverVersion.ToString();
            }
            catch
            {
                _hardwareAccessDriverInstalled = false;
                _hardwareAccessDriverVersion = "";
            }
            _cpuLoad.Sample();
            ThreadPool.QueueUserWorkItem(delegate { InitializeMemoryCounters(); });
            if (enhancedRequested)
            {
                _enhancedProcessorInitializing = true;
                _enhancedGraphicsInitializing = true;
                _enhancedBoardInitializing = true;
                _enhancedPeripheralInitializing = true;
                ThreadPool.QueueUserWorkItem(delegate { InitializeEnhancedHardware("processor"); });
                ThreadPool.QueueUserWorkItem(delegate { InitializeEnhancedHardware("peripheral"); });
            }
            QueueDirectPsuPolls();
        }

        private void InitializeMemoryCounters()
        {
            PerformanceCounter reads = CreateMemoryCounter("Page Faults/sec", "Pages Input/sec");
            PerformanceCounter writes = CreateMemoryCounter("Write Copies/sec", "Pages Output/sec");
            lock (_enhancedSync)
            {
                if (_disposed)
                {
                    if (reads != null) reads.Dispose();
                    if (writes != null) writes.Dispose();
                }
                else
                {
                    _memoryReadActivity = reads;
                    _memoryWriteActivity = writes;
                }
            }
        }

        private static PerformanceCounter CreateMemoryCounter(params string[] counterNames)
        {
            foreach (string counterName in counterNames)
            {
                PerformanceCounter counter = null;
                try
                {
                    counter = new PerformanceCounter("Memory", counterName, true);
                    counter.NextValue();
                    return counter;
                }
                catch
                {
                    if (counter != null) counter.Dispose();
                }
            }
            return null;
        }

        public Snapshot ReadSnapshot()
        {
            List<SensorRecord> sensors = new List<SensorRecord>();
            AddCpuAndMemorySensors(sensors);
            PresentMonFpsSnapshot presentMonSnapshot = AddPresentMonFpsSensors(sensors);
            QueueDirectPsuPolls();
            ThermaltakePsuSnapshot thermaltakeSnapshot;
            DigitalPsuSnapshot corsairSnapshot;
            DigitalPsuSnapshot nzxtSnapshot;
            lock (_directPsuSync)
            {
                thermaltakeSnapshot = IsFreshDirectPsuSnapshot(_thermaltakePsuSnapshotAt) ? _thermaltakePsuSnapshot : null;
                corsairSnapshot = IsFreshDirectPsuSnapshot(_corsairPsuSnapshotAt) ? _corsairPsuSnapshot : null;
                nzxtSnapshot = IsFreshDirectPsuSnapshot(_nzxtPsuSnapshotAt) ? _nzxtPsuSnapshot : null;
            }
            AddThermaltakePsuSensors(sensors, thermaltakeSnapshot);
            AddDigitalPsuSensors(sensors, corsairSnapshot, "corsair");
            AddDigitalPsuSensors(sensors, nzxtSnapshot, "nzxt_e");
            AddDriveSensors(sensors);
            AddNetworkSensors(sensors);

            int standardCount = sensors.Count;
            int enhancedCount = AddEnhancedSensors(sensors);
            UpdateOverallCpuClockFromEnhancedSensors(sensors);

            Dictionary<string, object> diagnostics = new Dictionary<string, object>();
            diagnostics["enhancedRequested"] = _enhancedRequested;
            bool coreAvailable = _processorComputer != null || _graphicsComputer != null || _boardComputer != null;
            bool coreInitializing = _enhancedProcessorInitializing || _enhancedGraphicsInitializing || _enhancedBoardInitializing;
            diagnostics["enhancedAvailable"] = coreAvailable || _peripheralComputer != null;
            diagnostics["enhancedInitializing"] = coreInitializing || _enhancedPeripheralInitializing;
            diagnostics["enhancedCoreAvailable"] = coreAvailable;
            diagnostics["enhancedCoreInitializing"] = coreInitializing;
            diagnostics["enhancedProcessorAvailable"] = _processorComputer != null;
            diagnostics["enhancedGraphicsAvailable"] = _graphicsComputer != null;
            diagnostics["enhancedBoardAvailable"] = _boardComputer != null;
            diagnostics["enhancedPeripheralAvailable"] = _peripheralComputer != null;
            diagnostics["enhancedPeripheralInitializing"] = _enhancedPeripheralInitializing;
            diagnostics["standardSensorCount"] = standardCount;
            diagnostics["enhancedSensorCount"] = enhancedCount;
            diagnostics["workingSetBytes"] = Process.GetCurrentProcess().WorkingSet64;
            diagnostics["directPsuDeviceIdsSupported"] = HardwareDeviceCatalog.DirectPsuDeviceIdCount;
            diagnostics["directPsuProtocolsSupported"] = HardwareDeviceCatalog.DirectPsuProtocolCount;
            diagnostics["enhancedHardwareFamilies"] = HardwareDeviceCatalog.CommonEnhancedFamilies;
            diagnostics["hardwareAccessDriverInstalled"] = _hardwareAccessDriverInstalled;
            diagnostics["hardwareAccessDriverVersion"] = _hardwareAccessDriverVersion;
            diagnostics["intelCpuDetected"] = sensors.Any(sensor =>
                String.Equals(sensor.hardwareType, "Cpu", StringComparison.OrdinalIgnoreCase) &&
                (sensor.name ?? "").IndexOf("intel", StringComparison.OrdinalIgnoreCase) >= 0);
            diagnostics["cpuPackagePowerAvailable"] = sensors.Any(sensor =>
                String.Equals(sensor.group, "cpu", StringComparison.OrdinalIgnoreCase) &&
                String.Equals(sensor.sensorType, "Power", StringComparison.OrdinalIgnoreCase) &&
                (sensor.name ?? "").IndexOf("package", StringComparison.OrdinalIgnoreCase) >= 0 &&
                IsPositiveSensorValue(sensor.value));
            diagnostics["unavailableCpuPowerDomains"] = _unavailableCpuPowerDomains.OrderBy(name => name).ToArray();
            diagnostics["nativeFpsAvailable"] = _presentMonFps.IsAvailable;
            diagnostics["nativeFpsRunning"] = _presentMonFps.IsRunning;
            diagnostics["nativeFpsApplication"] = presentMonSnapshot == null ? "" : presentMonSnapshot.Application;
            diagnostics["nativeFpsProcessId"] = presentMonSnapshot == null ? 0 : presentMonSnapshot.ProcessId;
            diagnostics["nativeFpsGpuVendor"] = _presentMonFps.GpuVendor;
            diagnostics["nativeFpsCaptureMethod"] = _presentMonFps.CaptureMethod;
            diagnostics["nativeFpsRecoveredTraceSessions"] = _presentMonFps.RecoveredTraceSessions;
            if (!String.IsNullOrWhiteSpace(_presentMonFps.LastError))
                diagnostics["nativeFpsError"] = _presentMonFps.LastError;
            if (!String.IsNullOrWhiteSpace(_presentMonFps.LastWarning))
                diagnostics["nativeFpsWarning"] = _presentMonFps.LastWarning;
            if (!String.IsNullOrWhiteSpace(_enhancedWarning))
                diagnostics["warning"] = _enhancedWarning;

            return new Snapshot
            {
                timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                sensors = sensors,
                diagnostics = diagnostics
            };
        }

        private void QueueDirectPsuPolls()
        {
            QueueThermaltakePsuPoll();
            QueueCorsairPsuPoll();
            QueueNzxtPsuPoll();
        }

        private void QueueThermaltakePsuPoll()
        {
            lock (_directPsuSync)
            {
                DateTime now = DateTime.UtcNow;
                if (_disposed || _thermaltakePsuPollRunning || now < _nextThermaltakePsuPoll) return;
                _thermaltakePsuPollRunning = true;
            }
            ThreadPool.QueueUserWorkItem(delegate
            {
                ThermaltakePsuSnapshot snapshot = null;
                try { snapshot = _thermaltakePsu.ReadSnapshot(); } catch { }
                lock (_directPsuSync)
                {
                    if (!_disposed && snapshot != null)
                    {
                        _thermaltakePsuSnapshot = snapshot;
                        _thermaltakePsuSnapshotAt = DateTime.UtcNow;
                    }
                    _thermaltakePsuPollRunning = false;
                    _nextThermaltakePsuPoll = DateTime.UtcNow.AddMilliseconds(750);
                }
            });
        }

        private void QueueCorsairPsuPoll()
        {
            lock (_directPsuSync)
            {
                DateTime now = DateTime.UtcNow;
                if (_disposed || _corsairPsuPollRunning || now < _nextCorsairPsuPoll) return;
                _corsairPsuPollRunning = true;
            }
            ThreadPool.QueueUserWorkItem(delegate
            {
                DigitalPsuSnapshot snapshot = null;
                try { snapshot = _corsairPsu.ReadSnapshot(); } catch { }
                lock (_directPsuSync)
                {
                    if (!_disposed && snapshot != null)
                    {
                        _corsairPsuSnapshot = snapshot;
                        _corsairPsuSnapshotAt = DateTime.UtcNow;
                    }
                    _corsairPsuPollRunning = false;
                    _nextCorsairPsuPoll = DateTime.UtcNow.AddMilliseconds(750);
                }
            });
        }

        private void QueueNzxtPsuPoll()
        {
            lock (_directPsuSync)
            {
                DateTime now = DateTime.UtcNow;
                if (_disposed || _nzxtPsuPollRunning || now < _nextNzxtPsuPoll) return;
                _nzxtPsuPollRunning = true;
            }
            ThreadPool.QueueUserWorkItem(delegate
            {
                DigitalPsuSnapshot snapshot = null;
                try { snapshot = _nzxtEPsu.ReadSnapshot(); } catch { }
                lock (_directPsuSync)
                {
                    if (!_disposed && snapshot != null)
                    {
                        _nzxtPsuSnapshot = snapshot;
                        _nzxtPsuSnapshotAt = DateTime.UtcNow;
                    }
                    _nzxtPsuPollRunning = false;
                    _nextNzxtPsuPoll = DateTime.UtcNow.AddMilliseconds(750);
                }
            });
        }

        private static bool IsFreshDirectPsuSnapshot(DateTime sampledAt)
        {
            return sampledAt != DateTime.MinValue &&
                   (DateTime.UtcNow - sampledAt).TotalSeconds <= DirectPsuSnapshotRetentionSeconds;
        }

        private void InitializeEnhancedHardware(string phase)
        {
            Computer computer = null;
            try
            {
                if (phase == "processor")
                {
                    computer = new Computer
                    {
                        IsCpuEnabled = true,
                        IsMemoryEnabled = true
                    };
                }
                else if (phase == "graphics")
                {
                    computer = new Computer
                    {
                        IsGpuEnabled = true
                    };
                }
                else if (phase == "board")
                {
                    computer = new Computer
                    {
                        IsMotherboardEnabled = true,
                        IsControllerEnabled = true,
                        IsPsuEnabled = true
                    };
                }
                else
                {
                    computer = new Computer
                    {
                        IsNetworkEnabled = true,
                        IsStorageEnabled = true
                    };
                }
                computer.Open();
                lock (_enhancedSync)
                {
                    if (_disposed)
                    {
                        try { computer.Close(); } catch { }
                    }
                    else
                    {
                        if (phase == "processor") _processorComputer = computer;
                        else if (phase == "graphics") _graphicsComputer = computer;
                        else if (phase == "board") _boardComputer = computer;
                        else _peripheralComputer = computer;
                    }
                    SetEnhancedPhaseInitializing(phase, false);
                }
            }
            catch (Exception error)
            {
                if (computer != null)
                {
                    try { computer.Close(); } catch { }
                }
                lock (_enhancedSync)
                {
                    string warning = phase + " discovery failed: " + error.GetType().Name + ": " + error.Message;
                    _enhancedWarning = String.IsNullOrWhiteSpace(_enhancedWarning)
                        ? warning
                        : _enhancedWarning + " | " + warning;
                    SetEnhancedPhaseInitializing(phase, false);
                }
            }
            finally
            {
                if (phase == "processor") QueueRemainingEnhancedPhases();
            }
        }

        private void QueueRemainingEnhancedPhases()
        {
            lock (_enhancedSync)
            {
                if (_disposed || _remainingEnhancedPhasesQueued) return;
                _remainingEnhancedPhasesQueued = true;
            }
            ThreadPool.QueueUserWorkItem(delegate { InitializeEnhancedHardware("graphics"); });
            ThreadPool.QueueUserWorkItem(delegate { InitializeEnhancedHardware("board"); });
        }

        private void SetEnhancedPhaseInitializing(string phase, bool initializing)
        {
            if (phase == "processor") _enhancedProcessorInitializing = initializing;
            else if (phase == "graphics") _enhancedGraphicsInitializing = initializing;
            else if (phase == "board") _enhancedBoardInitializing = initializing;
            else _enhancedPeripheralInitializing = initializing;
        }

        private void AddCpuAndMemorySensors(List<SensorRecord> sensors)
        {
            double? cpuLoad = _cpuLoad.Sample();
            if (cpuLoad.HasValue)
                sensors.Add(MakeSensor("builtin_os_cpu_load", "CPU Load", Math.Round(cpuLoad.Value, 2), "%", "cpu", "OperatingSystem", "Load"));

            double? cpuClockMhz = ReadAverageCpuClockMhz();
            if (cpuClockMhz.HasValue)
                sensors.Add(MakeSensor("builtin_os_cpu_clock_speed", "CPU Clock Speed", Math.Round(cpuClockMhz.Value, 2), "MHz", "cpu", "OperatingSystem", "Clock"));

            MemoryStatus memory = new MemoryStatus();
            memory.Length = (uint)Marshal.SizeOf(typeof(MemoryStatus));
            if (GlobalMemoryStatusEx(ref memory))
            {
                double totalGb = BytesToGb(memory.TotalPhysical);
                double availableGb = BytesToGb(memory.AvailablePhysical);
                double usedGb = Math.Max(0, totalGb - availableGb);
                sensors.Add(MakeSensor("builtin_os_memory_load", "Memory Usage", memory.MemoryLoad, "%", "ram", "OperatingSystem", "Load"));
                sensors.Add(MakeSensor("builtin_os_memory_used", "Memory Used", Math.Round(usedGb, 3), "GB", "ram", "OperatingSystem", "Data"));
                sensors.Add(MakeSensor("builtin_os_memory_available", "Memory Available", Math.Round(availableGb, 3), "GB", "ram", "OperatingSystem", "Data"));
            }

            double readRate = 0;
            double writeRate = 0;
            try
            {
                double pageSize = Math.Max(1, Environment.SystemPageSize);
                if (_memoryReadActivity != null)
                    readRate = Math.Max(0, Convert.ToDouble(_memoryReadActivity.NextValue())) * pageSize;
                if (_memoryWriteActivity != null)
                    writeRate = Math.Max(0, Convert.ToDouble(_memoryWriteActivity.NextValue())) * pageSize;
            }
            catch
            {
                // Performance counters can be unavailable on stripped-down Windows installations.
            }
            sensors.Add(MakeSensor("builtin_os_memory_read_rate", "Memory Read Speed", Math.Round(readRate, 2), "B/s", "ram", "OperatingSystem", "Throughput"));
            sensors.Add(MakeSensor("builtin_os_memory_write_rate", "Memory Write Speed", Math.Round(writeRate, 2), "B/s", "ram", "OperatingSystem", "Throughput"));
        }

        private static void AddThermaltakePsuSensors(List<SensorRecord> sensors, ThermaltakePsuSnapshot snapshot)
        {
            if (snapshot == null) return;

            string model = String.IsNullOrWhiteSpace(snapshot.Model) ? "Thermaltake PSU" : snapshot.Model;
            sensors.Add(MakeSensor("builtin_thermaltake_psu_ac_input_voltage", model + " AC Input Voltage", Math.Round(snapshot.AcInputVoltage, 3), "V", "psu", "Psu", "Voltage"));
            AddThermaltakeRailSensors(sensors, model, "12v", "+12V", snapshot.Rail12Voltage, snapshot.Rail12Current, snapshot.Rail12Power);
            AddThermaltakeRailSensors(sensors, model, "5v", "+5V", snapshot.Rail5Voltage, snapshot.Rail5Current, snapshot.Rail5Power);
            AddThermaltakeRailSensors(sensors, model, "3v3", "+3.3V", snapshot.Rail33Voltage, snapshot.Rail33Current, snapshot.Rail33Power);
            sensors.Add(MakeSensor("builtin_thermaltake_psu_output_power", model + " Output Power", Math.Round(snapshot.TotalOutputPower, 3), "W", "psu", "Psu", "Power"));
            sensors.Add(MakeSensor("builtin_thermaltake_psu_temperature", model + " Temperature", Math.Round(snapshot.Temperature, 2), "C", "psu", "Psu", "Temperature"));
            sensors.Add(MakeSensor("builtin_thermaltake_psu_fan", model + " Fan", Math.Round(snapshot.FanRpm, 0), "RPM", "psu", "Psu", "Fan"));
        }

        private static void AddThermaltakeRailSensors(List<SensorRecord> sensors, string model, string idPart, string railLabel, double voltage, double current, double power)
        {
            string idPrefix = "builtin_thermaltake_psu_" + idPart;
            string namePrefix = model + " " + railLabel + " Rail ";
            sensors.Add(MakeSensor(idPrefix + "_voltage", namePrefix + "Voltage", Math.Round(voltage, 4), "V", "psu", "Psu", "Voltage"));
            sensors.Add(MakeSensor(idPrefix + "_current", namePrefix + "Current", Math.Round(current, 4), "A", "psu", "Psu", "Current"));
            sensors.Add(MakeSensor(idPrefix + "_power", namePrefix + "Power", Math.Round(power, 4), "W", "psu", "Psu", "Power"));
        }

        private static void AddDigitalPsuSensors(List<SensorRecord> sensors, DigitalPsuSnapshot snapshot, string idFamily)
        {
            if (snapshot == null) return;

            string model = String.IsNullOrWhiteSpace(snapshot.Model) ? "Digital PSU" : snapshot.Model;
            string idPrefix = "builtin_" + Sanitize(idFamily) + "_psu_";
            if (snapshot.InputVoltage.HasValue)
                sensors.Add(MakeSensor(idPrefix + "input_voltage", model + " AC Input Voltage", Math.Round(snapshot.InputVoltage.Value, 3), "V", "psu", "Psu", "Voltage"));
            if (snapshot.InputCurrent.HasValue)
                sensors.Add(MakeSensor(idPrefix + "input_current", model + " AC Input Current", Math.Round(snapshot.InputCurrent.Value, 3), "A", "psu", "Psu", "Current"));

            foreach (PsuRailSnapshot rail in snapshot.Rails)
            {
                string railId = Sanitize(rail.Id);
                string namePrefix = model + " " + rail.Label + " Rail ";
                sensors.Add(MakeSensor(idPrefix + railId + "_voltage", namePrefix + "Voltage", Math.Round(rail.Voltage, 4), "V", "psu", "Psu", "Voltage"));
                sensors.Add(MakeSensor(idPrefix + railId + "_current", namePrefix + "Current", Math.Round(rail.Current, 4), "A", "psu", "Psu", "Current"));
                sensors.Add(MakeSensor(idPrefix + railId + "_power", namePrefix + "Power", Math.Round(rail.Power, 4), "W", "psu", "Psu", "Power"));
            }

            if (snapshot.TotalOutputPower.HasValue)
                sensors.Add(MakeSensor(idPrefix + "output_power", model + " Total Output Power", Math.Round(snapshot.TotalOutputPower.Value, 3), "W", "psu", "Psu", "Power"));
            if (snapshot.Temperature1.HasValue)
                sensors.Add(MakeSensor(idPrefix + "temperature", model + " Temperature", Math.Round(snapshot.Temperature1.Value, 2), "C", "psu", "Psu", "Temperature"));
            if (snapshot.Temperature2.HasValue)
                sensors.Add(MakeSensor(idPrefix + "vrm_temperature", model + " VRM Temperature", Math.Round(snapshot.Temperature2.Value, 2), "C", "psu", "Psu", "Temperature"));
            if (snapshot.FanRpm.HasValue)
                sensors.Add(MakeSensor(idPrefix + "fan", model + " Fan", Math.Round(snapshot.FanRpm.Value, 0), "RPM", "psu", "Psu", "Fan"));
        }

        private static double? ReadAverageCpuClockMhz()
        {
            int processorCount = Math.Max(1, Environment.ProcessorCount);
            int recordSize = Marshal.SizeOf(typeof(ProcessorPowerInformation));
            int bufferSize = checked(recordSize * processorCount);
            IntPtr buffer = Marshal.AllocHGlobal(bufferSize);
            try
            {
                uint status = CallNtPowerInformation(11, IntPtr.Zero, 0, buffer, (uint)bufferSize);
                if (status != 0) return null;

                double totalMhz = 0;
                int validRecords = 0;
                for (int index = 0; index < processorCount; index++)
                {
                    IntPtr recordPointer = IntPtr.Add(buffer, index * recordSize);
                    ProcessorPowerInformation information = (ProcessorPowerInformation)Marshal.PtrToStructure(recordPointer, typeof(ProcessorPowerInformation));
                    if (information.CurrentMhz == 0) continue;
                    totalMhz += information.CurrentMhz;
                    validRecords++;
                }

                return validRecords > 0 ? (double?)(totalMhz / validRecords) : null;
            }
            catch
            {
                return null;
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }

        private void AddDriveSensors(List<SensorRecord> sensors)
        {
            DateTime now = DateTime.UtcNow;
            if (_cachedDriveSensors.Count > 0 && (now - _lastDriveSample).TotalSeconds < 10)
            {
                sensors.AddRange(_cachedDriveSensors);
                return;
            }

            List<SensorRecord> driveSensors = new List<SensorRecord>();
            foreach (DriveInfo drive in DriveInfo.GetDrives())
            {
                try
                {
                    if (drive.DriveType != DriveType.Fixed && drive.DriveType != DriveType.Removable)
                        continue;
                    if (!drive.IsReady || drive.TotalSize <= 0)
                        continue;

                    string key = Sanitize(drive.Name.TrimEnd('\\', ':'));
                    double totalGb = BytesToGb((ulong)drive.TotalSize);
                    double freeGb = BytesToGb((ulong)drive.AvailableFreeSpace);
                    double usedGb = Math.Max(0, totalGb - freeGb);
                    double usePercent = totalGb > 0 ? (usedGb / totalGb) * 100.0 : 0;
                    string label = drive.Name.TrimEnd('\\') + " Drive";

                    driveSensors.Add(MakeSensor("builtin_os_drive_" + key + "_usage", label + " Usage", Math.Round(usePercent, 2), "%", "drives", "OperatingSystem", "Load"));
                    driveSensors.Add(MakeSensor("builtin_os_drive_" + key + "_used", label + " Used", Math.Round(usedGb, 3), "GB", "drives", "OperatingSystem", "Data"));
                    driveSensors.Add(MakeSensor("builtin_os_drive_" + key + "_free", label + " Free", Math.Round(freeGb, 3), "GB", "drives", "OperatingSystem", "Data"));
                }
                catch
                {
                    // A drive can disappear between enumeration and sampling.
                }
            }
            _cachedDriveSensors = driveSensors;
            _lastDriveSample = now;
            sensors.AddRange(_cachedDriveSensors);
        }

        private void AddNetworkSensors(List<SensorRecord> sensors)
        {
            DateTime now = DateTime.UtcNow;
            NetworkInterface[] adapters = NetworkInterface.GetAllNetworkInterfaces();
            string primaryLanIp = FindPrimaryLanIp(adapters);
            if (!String.IsNullOrWhiteSpace(primaryLanIp))
                sensors.Add(MakeSensor("builtin_os_network_lan_ip", "Primary IP Address", primaryLanIp, "", "network", "OperatingSystem", "Address"));

            foreach (NetworkInterface adapter in adapters)
            {
                if (adapter.OperationalStatus != OperationalStatus.Up || adapter.NetworkInterfaceType == NetworkInterfaceType.Loopback)
                    continue;

                try
                {
                    IPv4InterfaceStatistics stats = adapter.GetIPv4Statistics();
                    string key = adapter.Id ?? adapter.Name;
                    NetworkSample previous;
                    double downloadRate = 0;
                    double uploadRate = 0;
                    if (_networkSamples.TryGetValue(key, out previous))
                    {
                        double seconds = Math.Max(0.001, (now - previous.Timestamp).TotalSeconds);
                        downloadRate = Math.Max(0, stats.BytesReceived - previous.BytesReceived) / seconds;
                        uploadRate = Math.Max(0, stats.BytesSent - previous.BytesSent) / seconds;
                    }

                    _networkSamples[key] = new NetworkSample
                    {
                        Timestamp = now,
                        BytesReceived = stats.BytesReceived,
                        BytesSent = stats.BytesSent
                    };

                    string id = Sanitize(key);
                    string name = String.IsNullOrWhiteSpace(adapter.Name) ? "Network" : adapter.Name;
                    sensors.Add(MakeSensor("builtin_os_network_" + id + "_download", name + " Download Rate", Math.Round(downloadRate, 2), "B/s", "network", "OperatingSystem", "Throughput"));
                    sensors.Add(MakeSensor("builtin_os_network_" + id + "_upload", name + " Upload Rate", Math.Round(uploadRate, 2), "B/s", "network", "OperatingSystem", "Throughput"));
                }
                catch
                {
                    // Some virtual adapters do not expose IPv4 statistics.
                }
            }
        }

        private static string FindPrimaryLanIp(IEnumerable<NetworkInterface> adapters)
        {
            string fallback = null;
            foreach (NetworkInterface adapter in adapters ?? Enumerable.Empty<NetworkInterface>())
            {
                if (adapter == null || adapter.OperationalStatus != OperationalStatus.Up)
                    continue;
                if (adapter.NetworkInterfaceType == NetworkInterfaceType.Loopback || adapter.NetworkInterfaceType == NetworkInterfaceType.Tunnel)
                    continue;

                try
                {
                    IPInterfaceProperties properties = adapter.GetIPProperties();
                    string address = properties.UnicastAddresses
                        .Where(entry => entry != null && entry.Address != null && entry.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
                        .Select(entry => entry.Address.ToString())
                        .FirstOrDefault(value => !String.IsNullOrWhiteSpace(value) && !value.StartsWith("169.254.", StringComparison.Ordinal));
                    if (String.IsNullOrWhiteSpace(address))
                        continue;

                    bool hasIpv4Gateway = properties.GatewayAddresses.Any(entry =>
                        entry != null && entry.Address != null &&
                        entry.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork &&
                        !entry.Address.Equals(IPAddress.Any));
                    if (hasIpv4Gateway)
                        return address;
                    if (fallback == null)
                        fallback = address;
                }
                catch
                {
                    // Ignore adapters that disappear while their addresses are being queried.
                }
            }
            return fallback;
        }

        private int AddEnhancedSensors(List<SensorRecord> sensors)
        {
            lock (_enhancedSync)
            {
                Computer[] computers = new[] { _processorComputer, _graphicsComputer, _boardComputer, _peripheralComputer }
                    .Where(computer => computer != null)
                    .ToArray();
                if (computers.Length == 0)
                    return 0;

                int before = sensors.Count;
                foreach (Computer computer in computers)
                {
                    try
                    {
                        computer.Accept(_updateVisitor);
                        foreach (IHardware hardware in computer.Hardware)
                            AddHardwareTree(hardware, sensors);
                    }
                    catch (Exception error)
                    {
                        _enhancedWarning = error.GetType().Name + ": " + error.Message;
                    }
                }
                return sensors.Count - before;
            }
        }

        private static void UpdateOverallCpuClockFromEnhancedSensors(List<SensorRecord> sensors)
        {
            SensorRecord overallClock = sensors.FirstOrDefault(sensor => sensor.id == "builtin_os_cpu_clock_speed");
            if (overallClock == null) return;

            SensorRecord enhancedAverage = sensors
                .Where(sensor => sensor.id != overallClock.id && sensor.group == "cpu" &&
                                 String.Equals(sensor.sensorType, "Clock", StringComparison.OrdinalIgnoreCase))
                .Where(sensor =>
                {
                    string lowerName = (sensor.name ?? "").ToLowerInvariant();
                    return lowerName.Contains("average") && !lowerName.Contains("effective");
                })
                .FirstOrDefault(sensor =>
                {
                    try { return Convert.ToDouble(sensor.value) > 0; }
                    catch { return false; }
                });

            if (enhancedAverage == null) return;
            try
            {
                overallClock.value = Math.Round(Convert.ToDouble(enhancedAverage.value), 2);
                overallClock.hardwareType = enhancedAverage.hardwareType;
            }
            catch
            {
                // Keep the Windows-reported clock when an enhanced value cannot be converted.
            }
        }

        private static bool IsPositiveSensorValue(object value)
        {
            try
            {
                return Convert.ToDouble(value) > 0;
            }
            catch
            {
                return false;
            }
        }

        private PresentMonFpsSnapshot AddPresentMonFpsSensors(List<SensorRecord> sensors)
        {
            if (!_presentMonFps.IsAvailable) return null;

            PresentMonFpsSnapshot snapshot = _presentMonFps.ReadSnapshot();
            double fps = snapshot == null ? 0 : snapshot.FramesPerSecond;
            double frameTime = snapshot == null ? 0 : snapshot.FrameTimeMilliseconds;
            sensors.Add(MakeSensor(
                "builtin_presentmon_fps",
                "Native FPS",
                fps,
                "FPS",
                "fps",
                "WindowsPresentation",
                "Rate"));
            sensors.Add(MakeSensor(
                "builtin_presentmon_frametime",
                "Native Frame Time",
                frameTime,
                "ms",
                "fps",
                "WindowsPresentation",
                "Time"));
            return snapshot;
        }

        private void AddHardwareTree(IHardware hardware, List<SensorRecord> sensors)
        {
            string hardwareType = hardware.HardwareType.ToString();
            if (ShouldSkipEnhancedPsu(hardwareType, hardware.Name))
                return;
            foreach (ISensor sensor in hardware.Sensors)
            {
                if (!sensor.Value.HasValue || Single.IsNaN(sensor.Value.Value) || Single.IsInfinity(sensor.Value.Value))
                    continue;

                string sensorType = sensor.SensorType.ToString();
                if (sensorType.Equals("Temperature", StringComparison.OrdinalIgnoreCase) && sensor.Value.Value <= 0)
                    continue;
                string group = ClassifyGroup(hardwareType, sensorType, hardware.Name, sensor.Name);
                string fullName = BuildSensorName(hardware.Name, sensor.Name, hardwareType, sensorType);
                if (sensorType.Equals("Power", StringComparison.OrdinalIgnoreCase) &&
                    hardwareType.Equals("Cpu", StringComparison.OrdinalIgnoreCase) &&
                    (hardware.Name ?? "").IndexOf("Intel", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    string powerSensorId = sensor.Identifier.ToString();
                    if (sensor.Value.Value > 0)
                    {
                        _validatedCpuPowerSensorIds.Add(powerSensorId);
                        _unavailableCpuPowerDomains.Remove(fullName);
                    }
                    else if (!_validatedCpuPowerSensorIds.Contains(powerSensorId))
                    {
                        _unavailableCpuPowerDomains.Add(fullName);
                        continue;
                    }
                }
                if (_presentMonFps.IsAvailable && group.Equals("fps", StringComparison.OrdinalIgnoreCase))
                    continue;
                sensors.Add(MakeSensor(
                    "builtin_lhm_" + Sanitize(sensor.Identifier.ToString()),
                    fullName,
                    Math.Round(Convert.ToDouble(sensor.Value.Value), 4),
                    UnitsForSensorType(sensorType, fullName),
                    group,
                    hardwareType,
                    sensorType));
            }

            foreach (IHardware subHardware in hardware.SubHardware)
                AddHardwareTree(subHardware, sensors);
        }

        private bool ShouldSkipEnhancedPsu(string hardwareType, string hardwareName)
        {
            if (!String.Equals(hardwareType, "Psu", StringComparison.OrdinalIgnoreCase))
                return false;

            string lowerName = (hardwareName ?? "").ToLowerInvariant();
            lock (_directPsuSync)
            {
                if (_corsairPsuSnapshot != null && IsFreshDirectPsuSnapshot(_corsairPsuSnapshotAt) && lowerName.Contains("corsair")) return true;
                if (_nzxtPsuSnapshot != null && IsFreshDirectPsuSnapshot(_nzxtPsuSnapshotAt) && lowerName.Contains("nzxt")) return true;
                if (_thermaltakePsuSnapshot != null && IsFreshDirectPsuSnapshot(_thermaltakePsuSnapshotAt) && lowerName.Contains("thermaltake")) return true;
            }
            return false;
        }

        private static string BuildSensorName(string hardwareName, string sensorName, string hardwareType, string sensorType)
        {
            string fullName = ((hardwareName ?? "") + " " + (sensorName ?? "")).Trim();
            string lowerName = fullName.ToLowerInvariant();
            bool isGpu = (hardwareType ?? "").StartsWith("Gpu", StringComparison.OrdinalIgnoreCase) || lowerName.Contains("gpu");
            bool isCpu = String.Equals(hardwareType, "Cpu", StringComparison.OrdinalIgnoreCase) || lowerName.Contains("cpu");
            if (!isGpu && !isCpu)
                return fullName;

            string suffix = null;
            switch ((sensorType ?? "").ToLowerInvariant())
            {
                case "clock":
                    if (!lowerName.Contains("clock") && !lowerName.Contains("frequency")) suffix = "Clock";
                    break;
                case "voltage":
                    if (!lowerName.Contains("voltage") && !lowerName.Contains("volt")) suffix = "Voltage";
                    break;
                case "temperature":
                    if (!lowerName.Contains("temperature") && !lowerName.Contains("temp") && !lowerName.Contains("hot spot")) suffix = "Temperature";
                    break;
                case "load":
                    if (!lowerName.Contains("load") && !lowerName.Contains("usage") && !lowerName.Contains("utilization") && !lowerName.Contains("d3d")) suffix = "Load";
                    break;
                case "power":
                    if (!lowerName.Contains("power") && !lowerName.Contains("watt")) suffix = "Power";
                    break;
            }
            return String.IsNullOrWhiteSpace(suffix) ? fullName : (fullName + " " + suffix);
        }

        private static string ClassifyGroup(string hardwareType, string sensorType, string hardwareName, string sensorName)
        {
            string combined = (hardwareType + " " + hardwareName + " " + sensorName).ToLowerInvariant();
            if (combined.Contains("frametime") || combined.Contains("frame time") || combined.Contains(" fps")) return "fps";
            if (combined.Contains("power supply") || combined.Contains("psu")) return "psu";
            if (sensorType.Equals("Fan", StringComparison.OrdinalIgnoreCase) || combined.Contains(" fan")) return "fans";
            if (combined.Contains("gpu")) return "gpu";
            if (IsPowerSupplyRail(hardwareType, sensorType, sensorName)) return "psu";
            if (combined.Contains("cpu") || combined.Contains("processor")) return "cpu";
            if (combined.Contains("memory") || combined.Contains("ram") || combined.Contains("dimm")) return "ram";
            if (combined.Contains("storage") || combined.Contains("hdd") || combined.Contains("ssd") || combined.Contains("nvme")) return "drives";
            if (combined.Contains("network")) return "network";
            return "other";
        }

        private static bool IsPowerSupplyRail(string hardwareType, string sensorType, string sensorName)
        {
            if (!String.Equals(sensorType, "Voltage", StringComparison.OrdinalIgnoreCase)) return false;

            string lowerHardware = (hardwareType ?? "").ToLowerInvariant();
            bool isBoardMonitor = lowerHardware.Contains("motherboard") ||
                                  lowerHardware.Contains("superio") ||
                                  lowerHardware.Contains("embeddedcontroller") ||
                                  lowerHardware.Contains("powermonitor");
            if (!isBoardMonitor) return false;

            string compactName = new string((sensorName ?? "")
                .ToUpperInvariant()
                .Where(character => !Char.IsWhiteSpace(character))
                .ToArray());
            return compactName.Contains("+12V") || compactName == "12V" || compactName.Contains("12VRAIL") ||
                   compactName.Contains("+5V") || compactName == "5V" || compactName.Contains("5VSB") ||
                   compactName.Contains("+3.3V") || compactName.Contains("3.3VRAIL") ||
                   compactName.Contains("3VCC") || compactName.Contains("3VSB") || compactName.Contains("AVCC");
        }

        private static string UnitsForSensorType(string sensorType, string sensorName)
        {
            string lowerName = (sensorName ?? "").ToLowerInvariant();
            if (lowerName.Contains("frametime") || lowerName.Contains("frame time")) return "ms";
            if (lowerName.Contains(" fps")) return "FPS";
            switch (sensorType.ToLowerInvariant())
            {
                case "temperature": return "C";
                case "load": return "%";
                case "control": return "%";
                case "clock": return "MHz";
                case "fan": return "RPM";
                case "power": return "W";
                case "voltage": return "V";
                case "current": return "A";
                case "data": return "GB";
                case "smalldata": return "MB";
                case "throughput": return "B/s";
                case "energy": return "mWh";
                case "frequency": return "Hz";
                default: return "";
            }
        }

        private static SensorRecord MakeSensor(string id, string name, object value, string units, string group, string hardwareType, string sensorType)
        {
            return new SensorRecord
            {
                id = id,
                name = name,
                value = value,
                units = units,
                group = group,
                provider = "builtin",
                hardwareType = hardwareType,
                sensorType = sensorType,
                defaultEnabled = IsDefaultEnabled(id, name, group, sensorType)
            };
        }

        private static bool IsDefaultEnabled(string id, string name, string group, string sensorType)
        {
            string lowerId = (id ?? "").ToLowerInvariant();
            string lowerName = (name ?? "").ToLowerInvariant();
            string lowerType = (sensorType ?? "").ToLowerInvariant();

            if (lowerId == "builtin_os_cpu_load" || lowerId == "builtin_os_cpu_clock_speed" || lowerId == "builtin_os_memory_load" || lowerId == "builtin_os_memory_used" ||
                lowerId == "builtin_os_memory_read_rate" || lowerId == "builtin_os_memory_write_rate") return true;
            if (lowerId == "builtin_os_network_lan_ip" || lowerId == "builtin_os_network_wan_ip") return true;
            if (lowerId.StartsWith("builtin_os_drive_") && lowerId.EndsWith("_usage")) return true;
            if (lowerId.StartsWith("builtin_os_network_") && (lowerId.EndsWith("_download") || lowerId.EndsWith("_upload"))) return true;
            if (group == "fps") return true;
            if (group == "psu") return true;
            if (lowerType == "temperature" || lowerType == "fan") return true;
            if (group == "cpu" && lowerType == "power" && lowerName.Contains("package")) return true;
            if (group == "gpu" && lowerType == "load" && lowerName.Contains("gpu core")) return true;
            if (group == "gpu" && lowerType == "power" && lowerName.Contains("gpu package")) return true;
            if (group == "gpu" && lowerType == "smalldata" && lowerName.EndsWith("gpu memory used")) return true;
            return false;
        }

        private static string Sanitize(string value)
        {
            if (String.IsNullOrWhiteSpace(value))
                return "unknown";
            StringBuilder output = new StringBuilder(value.Length);
            foreach (char character in value.ToLowerInvariant())
                output.Append(Char.IsLetterOrDigit(character) ? character : '_');
            return output.ToString().Trim('_');
        }

        private static double BytesToGb(ulong bytes)
        {
            return bytes / 1024.0 / 1024.0 / 1024.0;
        }

        public void Dispose()
        {
            Computer processorComputer = null;
            Computer graphicsComputer = null;
            Computer boardComputer = null;
            Computer peripheralComputer = null;
            PerformanceCounter memoryReadActivity = null;
            PerformanceCounter memoryWriteActivity = null;
            lock (_enhancedSync)
            {
                _disposed = true;
                processorComputer = _processorComputer;
                graphicsComputer = _graphicsComputer;
                boardComputer = _boardComputer;
                peripheralComputer = _peripheralComputer;
                _processorComputer = null;
                _graphicsComputer = null;
                _boardComputer = null;
                _peripheralComputer = null;
                memoryReadActivity = _memoryReadActivity;
                memoryWriteActivity = _memoryWriteActivity;
                _memoryReadActivity = null;
                _memoryWriteActivity = null;
            }
            lock (_directPsuSync)
            {
                _thermaltakePsuSnapshot = null;
                _corsairPsuSnapshot = null;
                _nzxtPsuSnapshot = null;
                _thermaltakePsuSnapshotAt = DateTime.MinValue;
                _corsairPsuSnapshotAt = DateTime.MinValue;
                _nzxtPsuSnapshotAt = DateTime.MinValue;
            }
            if (processorComputer != null)
            {
                try { processorComputer.Close(); } catch { }
            }
            if (graphicsComputer != null)
            {
                try { graphicsComputer.Close(); } catch { }
            }
            if (boardComputer != null)
            {
                try { boardComputer.Close(); } catch { }
            }
            if (peripheralComputer != null)
            {
                try { peripheralComputer.Close(); } catch { }
            }
            if (memoryReadActivity != null) memoryReadActivity.Dispose();
            if (memoryWriteActivity != null) memoryWriteActivity.Dispose();
            _thermaltakePsu.Dispose();
            _corsairPsu.Dispose();
            _nzxtEPsu.Dispose();
            _presentMonFps.Dispose();
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct ProcessorPowerInformation
        {
            public uint Number;
            public uint MaxMhz;
            public uint CurrentMhz;
            public uint MhzLimit;
            public uint MaxIdleState;
            public uint CurrentIdleState;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
        private struct MemoryStatus
        {
            public uint Length;
            public uint MemoryLoad;
            public ulong TotalPhysical;
            public ulong AvailablePhysical;
            public ulong TotalPageFile;
            public ulong AvailablePageFile;
            public ulong TotalVirtual;
            public ulong AvailableVirtual;
            public ulong AvailableExtendedVirtual;
        }

        private sealed class NetworkSample
        {
            public DateTime Timestamp;
            public long BytesReceived;
            public long BytesSent;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern bool GlobalMemoryStatusEx(ref MemoryStatus buffer);

        [DllImport("powrprof.dll", SetLastError = false)]
        private static extern uint CallNtPowerInformation(int informationLevel, IntPtr inputBuffer, uint inputBufferLength, IntPtr outputBuffer, uint outputBufferLength);
    }

    internal static class Program
    {
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = Int32.MaxValue };

        public static int Main(string[] args)
        {
            bool enhanced = args.Any(arg => arg.Equals("--enhanced", StringComparison.OrdinalIgnoreCase));
            Console.InputEncoding = Encoding.UTF8;
            Console.OutputEncoding = new UTF8Encoding(false);

            using (SensorCollector collector = new SensorCollector(enhanced))
            {
                WriteMessage(new Dictionary<string, object>
                {
                    { "type", "ready" },
                    { "version", "0.1.0" },
                    { "enhancedRequested", enhanced }
                });

                string line;
                while ((line = Console.ReadLine()) != null)
                {
                    if (String.IsNullOrWhiteSpace(line))
                        continue;

                    object requestId = null;
                    try
                    {
                        Dictionary<string, object> request = Json.Deserialize<Dictionary<string, object>>(line);
                        if (request.ContainsKey("id")) requestId = request["id"];
                        string command = request.ContainsKey("command") ? Convert.ToString(request["command"]) : "snapshot";
                        if (command.Equals("shutdown", StringComparison.OrdinalIgnoreCase))
                        {
                            WriteMessage(Response(requestId, true, null, null));
                            break;
                        }

                        Snapshot snapshot = collector.ReadSnapshot();
                        WriteMessage(Response(requestId, true, snapshot, null));
                    }
                    catch (Exception error)
                    {
                        WriteMessage(Response(requestId, false, null, error.GetType().Name + ": " + error.Message));
                    }
                }
            }

            return 0;
        }

        private static Dictionary<string, object> Response(object id, bool ok, Snapshot snapshot, string error)
        {
            Dictionary<string, object> response = new Dictionary<string, object>();
            response["id"] = id;
            response["ok"] = ok;
            if (snapshot != null) response["snapshot"] = snapshot;
            if (!String.IsNullOrWhiteSpace(error)) response["error"] = error;
            return response;
        }

        private static void WriteMessage(object message)
        {
            Console.WriteLine(Json.Serialize(message));
            Console.Out.Flush();
        }
    }
}
