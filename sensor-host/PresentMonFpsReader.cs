using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Management;
using System.Runtime.InteropServices;
using System.Text;

namespace SiR.SensorHost
{
    internal sealed class PresentMonFpsSnapshot
    {
        public double FramesPerSecond;
        public double FrameTimeMilliseconds;
        public string Application = "";
        public int ProcessId;
    }

    internal sealed class PresentMonFpsReader : IDisposable
    {
        private const int RetryDelayMilliseconds = 5000;
        private const double SampleRetentionMilliseconds = 2500;
        private const double FpsWindowMilliseconds = 1200;
        private const string SessionPrefix = "SiRSystemMonitor_";
        private readonly object _sync = new object();
        private readonly string _executablePath;
        private readonly string _sessionName;
        private readonly GpuAdapterProfile _gpuProfile;
        private readonly Dictionary<int, ProcessFrames> _processes = new Dictionary<int, ProcessFrames>();
        private readonly HashSet<string> _excludedApplications = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "dwm.exe",
            "explorer.exe",
            "searchhost.exe",
            "shellexperiencehost.exe",
            "startmenuexperiencehost.exe",
            "applicationframehost.exe",
            "textinputhost.exe",
            "lockapp.exe",
            "systemsettings.exe",
            "sirsystemmonitor.exe",
            "sir system monitor.exe",
            "electron.exe",
            "codex.exe",
            "discord.exe",
            "steamwebhelper.exe",
            "epicgameslauncher.exe",
            "riotclientservices.exe",
            "battle.net.exe",
            "eadesktop.exe",
            "ubisoftconnect.exe"
        };
        private Process _process;
        private IntPtr _jobHandle;
        private Dictionary<string, int> _columns;
        private DateTime _nextStartAttemptUtc = DateTime.MinValue;
        private int _lastActiveProcessId;
        private string _lastError = "";
        private string _lastWarning = "";
        private int _recoveredTraceSessions;
        private bool _disposed;

        public PresentMonFpsReader()
        {
            _executablePath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "PresentMon.exe");
            _sessionName = SessionPrefix + Process.GetCurrentProcess().Id;
            _gpuProfile = DetectGpuAdapters();
            _jobHandle = CreateKillOnCloseJob();
        }

        public bool IsAvailable
        {
            get { return File.Exists(_executablePath); }
        }

        public bool IsRunning
        {
            get
            {
                lock (_sync)
                {
                    return _process != null && !_process.HasExited;
                }
            }
        }

        public string LastError
        {
            get { lock (_sync) { return _lastError; } }
        }

        public string LastWarning
        {
            get { lock (_sync) { return _lastWarning; } }
        }

        public string GpuVendor
        {
            get { return _gpuProfile.Vendor; }
        }

        public string CaptureMethod
        {
            get { return _gpuProfile.PreferDisplayedTiming ? "displayed frames" : "presented frames"; }
        }

        public int RecoveredTraceSessions
        {
            get { lock (_sync) { return _recoveredTraceSessions; } }
        }

        public PresentMonFpsSnapshot ReadSnapshot()
        {
            EnsureStarted();

            lock (_sync)
            {
                DateTime staleArrivalCutoff = DateTime.UtcNow.AddMilliseconds(-SampleRetentionMilliseconds);
                List<int> staleProcesses = _processes
                    .Where(pair => pair.Value.LastArrivalUtc < staleArrivalCutoff)
                    .Select(pair => pair.Key)
                    .ToList();
                foreach (int processId in staleProcesses)
                    _processes.Remove(processId);

                List<FrameCandidate> candidates = new List<FrameCandidate>();
                foreach (ProcessFrames processFrames in _processes.Values)
                {
                    foreach (SwapChainFrames swapChain in processFrames.SwapChains.Values)
                    {
                        // PresentMon's TimeInSeconds value is relative to the current capture,
                        // so retain samples using that same timeline. Comparing it with the
                        // system-wide Stopwatch clock discards every frame on each snapshot.
                        if (swapChain.Samples.Count > 0)
                        {
                            double newestQpcMilliseconds = swapChain.Samples[swapChain.Samples.Count - 1].QpcMilliseconds;
                            TrimSamples(swapChain, newestQpcMilliseconds - SampleRetentionMilliseconds);
                        }
                        FrameCandidate candidate = BuildCandidate(processFrames, swapChain);
                        if (candidate != null)
                            candidates.Add(candidate);
                    }
                }

                if (candidates.Count == 0)
                    return null;

                int foregroundProcessId = GetForegroundProcessId();
                FrameCandidate selected = candidates
                    .Where(candidate => candidate.ProcessId == foregroundProcessId &&
                                        (IsUnknownApplication(candidate.Application) || !IsExcludedApplication(candidate.Application)))
                    .OrderByDescending(candidate => candidate.SampleCount)
                    .FirstOrDefault();

                if (selected != null)
                    _lastActiveProcessId = selected.ProcessId;

                if (selected == null && _lastActiveProcessId > 0)
                {
                    selected = candidates
                        .Where(candidate => candidate.ProcessId == _lastActiveProcessId)
                        .OrderByDescending(candidate => candidate.SampleCount)
                        .FirstOrDefault();
                }

                if (selected == null)
                {
                    selected = candidates
                        .Where(candidate => !IsExcludedApplication(candidate.Application))
                        .OrderByDescending(candidate => candidate.SampleCount)
                        .ThenByDescending(candidate => candidate.LastQpcMilliseconds)
                        .FirstOrDefault();
                }

                if (selected == null)
                    return null;

                _lastActiveProcessId = selected.ProcessId;
                return new PresentMonFpsSnapshot
                {
                    FramesPerSecond = Math.Round(selected.FramesPerSecond, 2),
                    FrameTimeMilliseconds = Math.Round(selected.FrameTimeMilliseconds, 4),
                    Application = selected.Application,
                    ProcessId = selected.ProcessId
                };
            }
        }

        private bool EnsureStarted()
        {
            lock (_sync)
            {
                if (_disposed) return false;
                if (_process != null && !_process.HasExited) return true;
                if (!IsAvailable)
                {
                    _lastError = "PresentMon.exe is missing from the sensor-host resources.";
                    return false;
                }
                if (DateTime.UtcNow < _nextStartAttemptUtc) return false;

                _nextStartAttemptUtc = DateTime.UtcNow.AddMilliseconds(RetryDelayMilliseconds);
                try
                {
                    _recoveredTraceSessions += CleanupOrphanedTraceSessions(_sessionName);
                    Process process = new Process();
                    process.StartInfo = new ProcessStartInfo
                    {
                        FileName = _executablePath,
                        Arguments = BuildArguments(),
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        WorkingDirectory = AppDomain.CurrentDomain.BaseDirectory
                    };
                    process.EnableRaisingEvents = true;
                    process.OutputDataReceived += HandleOutputData;
                    process.ErrorDataReceived += HandleErrorData;
                    process.Exited += delegate { HandleProcessExit(process); };
                    if (!process.Start())
                    {
                        process.Dispose();
                        _lastError = "PresentMon did not start.";
                        return false;
                    }

                    _process = process;
                    _columns = null;
                    _processes.Clear();
                    _lastError = "";
                    _lastWarning = "";
                    if (_jobHandle != IntPtr.Zero && !AssignProcessToJobObject(_jobHandle, process.Handle))
                        _lastWarning = "PresentMon could not be attached to the sensor-host lifetime job.";
                    process.BeginOutputReadLine();
                    process.BeginErrorReadLine();
                    return true;
                }
                catch (Exception error)
                {
                    _process = null;
                    _lastError = error.GetType().Name + ": " + error.Message;
                    return false;
                }
            }
        }

        private string BuildArguments()
        {
            StringBuilder arguments = new StringBuilder();
            arguments.Append("--output_stdout --no_console_stats --v1_metrics --qpc_time_ms ");
            arguments.Append("--no_track_gpu --no_track_input ");
            if (!_gpuProfile.PreferDisplayedTiming)
                arguments.Append("--no_track_display ");
            if (_gpuProfile.TrackHybridPresents)
                arguments.Append("--track_hybrid_present ");
            arguments.Append("--stop_existing_session --session_name ").Append(_sessionName);
            foreach (string application in _excludedApplications)
                arguments.Append(" --exclude \"").Append(application.Replace("\"", "")).Append("\"");
            return arguments.ToString();
        }

        private void HandleOutputData(object sender, DataReceivedEventArgs eventArgs)
        {
            string line = eventArgs.Data;
            if (String.IsNullOrWhiteSpace(line)) return;

            lock (_sync)
            {
                List<string> fields = ParseCsvLine(line);
                if (_columns == null)
                {
                    if (fields.Count < 3 || !fields.Any(field => field.Equals("Application", StringComparison.OrdinalIgnoreCase)))
                        return;
                    _columns = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                    for (int index = 0; index < fields.Count; index++)
                        _columns[fields[index]] = index;
                    return;
                }

                string application = GetField(fields, "Application");
                int processId;
                if (String.IsNullOrWhiteSpace(application) || !Int32.TryParse(GetField(fields, "ProcessID"), out processId) || processId <= 0)
                    return;

                string swapChain = GetField(fields, "SwapChainAddress");
                if (String.IsNullOrWhiteSpace(swapChain)) swapChain = "default";

                double qpcMilliseconds;
                if (!TryParseDouble(GetFirstField(fields, "CPUStartQPCTimeInMs", "CPUStartQPCTime", "CPUStartTime"), out qpcMilliseconds))
                {
                    double timeInSeconds;
                    if (!TryParseDouble(GetField(fields, "TimeInSeconds"), out timeInSeconds)) return;
                    qpcMilliseconds = timeInSeconds * 1000.0;
                }

                double betweenPresents;
                if (!TryParseDouble(GetField(fields, "MsBetweenPresents"), out betweenPresents))
                    betweenPresents = Double.NaN;
                double betweenDisplayChanges;
                if (!TryParseDouble(GetField(fields, "MsBetweenDisplayChange"), out betweenDisplayChanges))
                    betweenDisplayChanges = Double.NaN;

                ProcessFrames processFrames;
                if (!_processes.TryGetValue(processId, out processFrames))
                {
                    processFrames = new ProcessFrames { ProcessId = processId };
                    _processes[processId] = processFrames;
                }
                processFrames.Application = application;
                processFrames.LastArrivalUtc = DateTime.UtcNow;

                SwapChainFrames chain;
                if (!processFrames.SwapChains.TryGetValue(swapChain, out chain))
                {
                    chain = new SwapChainFrames();
                    processFrames.SwapChains[swapChain] = chain;
                }

                long sampleKey = (long)Math.Round(qpcMilliseconds * 1000.0);
                if (!chain.SampleKeys.Add(sampleKey)) return;
                chain.Samples.Add(new FrameSample
                {
                    QpcMilliseconds = qpcMilliseconds,
                    BetweenPresentsMilliseconds = betweenPresents,
                    BetweenDisplayChangesMilliseconds = betweenDisplayChanges
                });
                TrimSamples(chain, qpcMilliseconds - SampleRetentionMilliseconds);
            }
        }

        private void HandleErrorData(object sender, DataReceivedEventArgs eventArgs)
        {
            string line = (eventArgs.Data ?? "").Trim();
            if (line.Length == 0) return;
            lock (_sync)
            {
                if (line.StartsWith("warning", StringComparison.OrdinalIgnoreCase) ||
                    line.StartsWith("short-running", StringComparison.OrdinalIgnoreCase) ||
                    line.StartsWith("be listed", StringComparison.OrdinalIgnoreCase) ||
                    line.StartsWith("--terminate_on_proc_exit", StringComparison.OrdinalIgnoreCase))
                    _lastWarning = String.IsNullOrWhiteSpace(_lastWarning) ? line : (_lastWarning + " " + line);
                else
                    _lastError = line;
            }
        }

        private void HandleProcessExit(Process process)
        {
            lock (_sync)
            {
                if (_process != process) return;
                _process = null;
                _columns = null;
                try
                {
                    if (process.ExitCode != 0 && String.IsNullOrWhiteSpace(_lastError))
                        _lastError = "PresentMon exited with code " + process.ExitCode + ".";
                }
                catch { }
                _nextStartAttemptUtc = DateTime.UtcNow.AddMilliseconds(RetryDelayMilliseconds);
            }
            try { process.Dispose(); } catch { }
        }

        private FrameCandidate BuildCandidate(ProcessFrames processFrames, SwapChainFrames chain)
        {
            if (chain.Samples.Count < 3) return null;
            double newest = chain.Samples[chain.Samples.Count - 1].QpcMilliseconds;
            double cutoff = newest - FpsWindowMilliseconds;
            List<FrameSample> samples = chain.Samples.Where(sample => sample.QpcMilliseconds >= cutoff).ToList();
            if (samples.Count < 3) return null;

            List<double> intervals = samples
                .Select(sample => _gpuProfile.PreferDisplayedTiming && IsValidFrameInterval(sample.BetweenDisplayChangesMilliseconds)
                    ? sample.BetweenDisplayChangesMilliseconds
                    : sample.BetweenPresentsMilliseconds)
                .Where(IsValidFrameInterval)
                .OrderBy(value => value)
                .ToList();

            double frameTime;
            if (intervals.Count >= 3)
            {
                int trim = intervals.Count >= 10 ? Math.Max(1, intervals.Count / 10) : 0;
                List<double> stableIntervals = intervals.Skip(trim).Take(intervals.Count - (trim * 2)).ToList();
                frameTime = stableIntervals.Average();
            }
            else
            {
                double span = samples[samples.Count - 1].QpcMilliseconds - samples[0].QpcMilliseconds;
                if (span <= 0) return null;
                frameTime = span / (samples.Count - 1);
            }
            double fps = 1000.0 / frameTime;
            if (Double.IsNaN(fps) || Double.IsInfinity(fps) || fps <= 0 || fps > 2000) return null;
            return new FrameCandidate
            {
                ProcessId = processFrames.ProcessId,
                Application = processFrames.Application,
                FramesPerSecond = fps,
                FrameTimeMilliseconds = frameTime,
                SampleCount = samples.Count,
                LastQpcMilliseconds = newest
            };
        }

        private static void TrimSamples(SwapChainFrames chain, double cutoff)
        {
            int removeCount = 0;
            while (removeCount < chain.Samples.Count && chain.Samples[removeCount].QpcMilliseconds < cutoff)
            {
                long key = (long)Math.Round(chain.Samples[removeCount].QpcMilliseconds * 1000.0);
                chain.SampleKeys.Remove(key);
                removeCount++;
            }
            if (removeCount > 0)
                chain.Samples.RemoveRange(0, removeCount);
        }

        private bool IsExcludedApplication(string application)
        {
            if (IsUnknownApplication(application)) return true;
            string name = (application ?? "").Trim().Replace('\\', '/');
            int separatorIndex = name.LastIndexOf('/');
            if (separatorIndex >= 0 && separatorIndex + 1 < name.Length)
                name = name.Substring(separatorIndex + 1);
            return _excludedApplications.Contains(name);
        }

        private static bool IsUnknownApplication(string application)
        {
            return String.Equals((application ?? "").Trim(), "<unknown>", StringComparison.OrdinalIgnoreCase);
        }

        private string GetField(List<string> fields, string name)
        {
            int index;
            if (_columns == null || !_columns.TryGetValue(name, out index) || index < 0 || index >= fields.Count)
                return "";
            return fields[index];
        }

        private string GetFirstField(List<string> fields, params string[] names)
        {
            foreach (string name in names)
            {
                string value = GetField(fields, name);
                if (!String.IsNullOrWhiteSpace(value)) return value;
            }
            return "";
        }

        private static bool IsValidFrameInterval(double value)
        {
            return !Double.IsNaN(value) && !Double.IsInfinity(value) && value >= 0.1 && value <= 1000;
        }

        private static bool TryParseDouble(string value, out double result)
        {
            return Double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out result);
        }

        private static List<string> ParseCsvLine(string line)
        {
            List<string> fields = new List<string>();
            StringBuilder field = new StringBuilder();
            bool quoted = false;
            for (int index = 0; index < line.Length; index++)
            {
                char character = line[index];
                if (character == '"')
                {
                    if (quoted && index + 1 < line.Length && line[index + 1] == '"')
                    {
                        field.Append('"');
                        index++;
                    }
                    else
                    {
                        quoted = !quoted;
                    }
                }
                else if (character == ',' && !quoted)
                {
                    fields.Add(field.ToString());
                    field.Clear();
                }
                else
                {
                    field.Append(character);
                }
            }
            fields.Add(field.ToString());
            return fields;
        }

        private static int GetForegroundProcessId()
        {
            try
            {
                IntPtr window = GetForegroundWindow();
                if (window == IntPtr.Zero) return 0;
                uint processId;
                GetWindowThreadProcessId(window, out processId);
                return (int)processId;
            }
            catch
            {
                return 0;
            }
        }

        public void Dispose()
        {
            Process process = null;
            IntPtr jobHandle = IntPtr.Zero;
            lock (_sync)
            {
                if (_disposed) return;
                _disposed = true;
                process = _process;
                _process = null;
                _columns = null;
                _processes.Clear();
                jobHandle = _jobHandle;
                _jobHandle = IntPtr.Zero;
            }
            if (process != null)
            {
                try
                {
                    if (!process.HasExited)
                    {
                        StopTraceSession(_sessionName);
                        if (!process.WaitForExit(1500)) process.Kill();
                    }
                }
                catch { }
                try { process.Dispose(); } catch { }
            }
            if (jobHandle != IntPtr.Zero)
            {
                try { CloseHandle(jobHandle); } catch { }
            }
        }

        private static GpuAdapterProfile DetectGpuAdapters()
        {
            HashSet<string> vendors = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                using (ManagementObjectSearcher searcher = new ManagementObjectSearcher("SELECT Name, AdapterCompatibility, PNPDeviceID FROM Win32_VideoController"))
                using (ManagementObjectCollection adapters = searcher.Get())
                {
                    foreach (ManagementObject adapter in adapters)
                    {
                        string descriptor = String.Join(" ", new[]
                        {
                            Convert.ToString(adapter["Name"], CultureInfo.InvariantCulture),
                            Convert.ToString(adapter["AdapterCompatibility"], CultureInfo.InvariantCulture),
                            Convert.ToString(adapter["PNPDeviceID"], CultureInfo.InvariantCulture)
                        }).ToLowerInvariant();
                        if (descriptor.Contains("ven_1002") || descriptor.Contains("advanced micro devices") || descriptor.Contains("radeon"))
                            vendors.Add("AMD");
                        else if (descriptor.Contains("ven_10de") || descriptor.Contains("nvidia"))
                            vendors.Add("NVIDIA");
                        else if (descriptor.Contains("ven_8086") || descriptor.Contains("intel"))
                            vendors.Add("Intel");
                    }
                }
            }
            catch { }

            string[] ordered = new[] { "AMD", "NVIDIA", "Intel" }.Where(vendors.Contains).ToArray();
            bool hasAmd = vendors.Contains("AMD");
            bool hybrid = vendors.Count > 1 || hasAmd;
            return new GpuAdapterProfile
            {
                Vendor = ordered.Length == 0 ? "Unknown" : String.Join(" + ", ordered),
                PreferDisplayedTiming = hasAmd,
                TrackHybridPresents = hybrid
            };
        }

        private static int CleanupOrphanedTraceSessions(string currentSessionName)
        {
            int recovered = 0;
            foreach (string sessionName in GetActiveTraceSessionNames())
            {
                bool owned = sessionName.StartsWith(SessionPrefix, StringComparison.OrdinalIgnoreCase) ||
                             sessionName.Equals("SiRSystemMonitor", StringComparison.OrdinalIgnoreCase) ||
                             sessionName.Equals("SiRPresentMonAudit", StringComparison.OrdinalIgnoreCase);
                if (!owned || IsLiveSensorHostSession(sessionName, currentSessionName)) continue;
                if (StopTraceSession(sessionName) == 0) recovered++;
            }
            return recovered;
        }

        private static bool IsLiveSensorHostSession(string sessionName, string currentSessionName)
        {
            if (sessionName.Equals(currentSessionName, StringComparison.OrdinalIgnoreCase)) return false;
            if (!sessionName.StartsWith(SessionPrefix, StringComparison.OrdinalIgnoreCase)) return false;
            int processId;
            if (!Int32.TryParse(sessionName.Substring(SessionPrefix.Length), out processId) || processId <= 0) return false;
            try
            {
                using (Process process = Process.GetProcessById(processId))
                    return process.ProcessName.Equals("SiR.SensorHost", StringComparison.OrdinalIgnoreCase);
            }
            catch
            {
                return false;
            }
        }

        private static List<string> GetActiveTraceSessionNames()
        {
            const int maximumSessions = 64;
            const int bufferSize = 4096;
            int propertiesSize = Marshal.SizeOf(typeof(EventTraceProperties));
            IntPtr[] buffers = new IntPtr[maximumSessions];
            List<string> names = new List<string>();
            try
            {
                for (int index = 0; index < buffers.Length; index++)
                {
                    buffers[index] = Marshal.AllocHGlobal(bufferSize);
                    for (int offset = 0; offset < bufferSize; offset += 4)
                        Marshal.WriteInt32(buffers[index], offset, 0);
                    EventTraceProperties properties = new EventTraceProperties();
                    properties.Wnode.BufferSize = (uint)bufferSize;
                    properties.Wnode.Flags = WnodeFlagTracedGuid;
                    properties.LoggerNameOffset = (uint)propertiesSize;
                    properties.LogFileNameOffset = (uint)(propertiesSize + 1024);
                    Marshal.StructureToPtr(properties, buffers[index], false);
                }

                uint sessionCount;
                uint result = QueryAllTraces(buffers, (uint)buffers.Length, out sessionCount);
                if (result != 0 && result != ErrorMoreData) return names;
                int count = (int)Math.Min(sessionCount, (uint)buffers.Length);
                for (int index = 0; index < count; index++)
                {
                    EventTraceProperties properties = (EventTraceProperties)Marshal.PtrToStructure(buffers[index], typeof(EventTraceProperties));
                    if (properties.LoggerNameOffset == 0 || properties.LoggerNameOffset >= bufferSize) continue;
                    string name = Marshal.PtrToStringUni(IntPtr.Add(buffers[index], (int)properties.LoggerNameOffset));
                    if (!String.IsNullOrWhiteSpace(name)) names.Add(name.Trim());
                }
            }
            catch { }
            finally
            {
                foreach (IntPtr buffer in buffers)
                    if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer);
            }
            return names;
        }

        private static uint StopTraceSession(string sessionName)
        {
            if (String.IsNullOrWhiteSpace(sessionName)) return 1;
            int propertiesSize = Marshal.SizeOf(typeof(EventTraceProperties));
            IntPtr buffer = Marshal.AllocHGlobal(4096);
            try
            {
                for (int offset = 0; offset < 4096; offset += 4)
                    Marshal.WriteInt32(buffer, offset, 0);
                EventTraceProperties properties = new EventTraceProperties();
                properties.Wnode.BufferSize = 4096;
                properties.Wnode.Flags = WnodeFlagTracedGuid;
                properties.LoggerNameOffset = (uint)propertiesSize;
                properties.LogFileNameOffset = (uint)(propertiesSize + 1024);
                Marshal.StructureToPtr(properties, buffer, false);
                return ControlTrace(0, sessionName, buffer, EventTraceControlStop);
            }
            catch
            {
                return 1;
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }

        private static IntPtr CreateKillOnCloseJob()
        {
            try
            {
                IntPtr jobHandle = CreateJobObject(IntPtr.Zero, null);
                if (jobHandle == IntPtr.Zero) return IntPtr.Zero;
                JobObjectExtendedLimitInformation information = new JobObjectExtendedLimitInformation();
                information.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;
                int length = Marshal.SizeOf(typeof(JobObjectExtendedLimitInformation));
                if (!SetInformationJobObject(jobHandle, JobObjectExtendedLimitInformationClass, ref information, (uint)length))
                {
                    CloseHandle(jobHandle);
                    return IntPtr.Zero;
                }
                return jobHandle;
            }
            catch
            {
                return IntPtr.Zero;
            }
        }

        private sealed class ProcessFrames
        {
            public int ProcessId;
            public string Application = "";
            public DateTime LastArrivalUtc = DateTime.MinValue;
            public readonly Dictionary<string, SwapChainFrames> SwapChains = new Dictionary<string, SwapChainFrames>(StringComparer.OrdinalIgnoreCase);
        }

        private sealed class SwapChainFrames
        {
            public readonly List<FrameSample> Samples = new List<FrameSample>();
            public readonly HashSet<long> SampleKeys = new HashSet<long>();
        }

        private sealed class FrameSample
        {
            public double QpcMilliseconds;
            public double BetweenPresentsMilliseconds;
            public double BetweenDisplayChangesMilliseconds;
        }

        private sealed class GpuAdapterProfile
        {
            public string Vendor = "Unknown";
            public bool PreferDisplayedTiming;
            public bool TrackHybridPresents;
        }

        private sealed class FrameCandidate
        {
            public int ProcessId;
            public string Application = "";
            public double FramesPerSecond;
            public double FrameTimeMilliseconds;
            public int SampleCount;
            public double LastQpcMilliseconds;
        }

        private const uint JobObjectLimitKillOnJobClose = 0x00002000;
        private const int JobObjectExtendedLimitInformationClass = 9;
        private const uint WnodeFlagTracedGuid = 0x00020000;
        private const uint EventTraceControlStop = 1;
        private const uint ErrorMoreData = 234;

        [StructLayout(LayoutKind.Sequential)]
        private struct WnodeHeader
        {
            public uint BufferSize;
            public uint ProviderId;
            public ulong HistoricalContext;
            public ulong TimeStamp;
            public Guid Guid;
            public uint ClientContext;
            public uint Flags;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct EventTraceProperties
        {
            public WnodeHeader Wnode;
            public uint BufferSize;
            public uint MinimumBuffers;
            public uint MaximumBuffers;
            public uint MaximumFileSize;
            public uint LogFileMode;
            public uint FlushTimer;
            public uint EnableFlags;
            public int AgeLimit;
            public uint NumberOfBuffers;
            public uint FreeBuffers;
            public uint EventsLost;
            public uint BuffersWritten;
            public uint LogBuffersLost;
            public uint RealTimeBuffersLost;
            public IntPtr LoggerThreadId;
            public uint LogFileNameOffset;
            public uint LoggerNameOffset;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IoCounters
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JobObjectBasicLimitInformation
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JobObjectExtendedLimitInformation
        {
            public JobObjectBasicLimitInformation BasicLimitInformation;
            public IoCounters IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObject(IntPtr securityAttributes, string name);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(IntPtr job, int informationClass, ref JobObjectExtendedLimitInformation information, uint informationLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);

        [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
        private static extern uint QueryAllTraces([In, Out] IntPtr[] propertyArray, uint propertyArrayCount, out uint sessionCount);

        [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
        private static extern uint ControlTrace(ulong traceHandle, string instanceName, IntPtr properties, uint controlCode);
    }
}
