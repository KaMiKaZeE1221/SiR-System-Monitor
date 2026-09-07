using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;

namespace SiR.SensorHost
{
    internal sealed class AmdAdlxFanController : IDisposable
    {
        private sealed class FanBinding
        {
            public string Name;
            public string NormalizedName;
            public object Gpu;
            public object FanTuning;
            public bool SupportsTargetFanSpeed;
            public bool SupportsFanTuningStates;
            public bool SupportsZeroRpm;
            public int MinimumPercent;
            public int MaximumPercent;
            public bool Claimed;
            public double? LastPercent;
        }

        private readonly object _sync = new object();
        private readonly List<FanBinding> _bindings = new List<FanBinding>();
        private bool _initializationAttempted;
        private bool _disposed;
        private string _lastError = "";
        private object _wrapper;
        private object _systemServices;
        private object _tuningService;

        public string LastError
        {
            get { lock (_sync) return _lastError; }
        }

        public bool TryGetLimits(string hardwareName, out double minimumPercent, out double maximumPercent, out string error)
        {
            lock (_sync)
            {
                minimumPercent = 0;
                maximumPercent = 100;
                FanBinding binding;
                if (!TryResolveBindingLocked(hardwareName, out binding, out error))
                    return false;

                minimumPercent = binding.MinimumPercent;
                maximumPercent = binding.MaximumPercent;
                return true;
            }
        }

        public bool IsClaimed(string hardwareName)
        {
            lock (_sync)
            {
                FanBinding binding;
                string error;
                return TryResolveBindingLocked(hardwareName, out binding, out error) && binding.Claimed;
            }
        }

        public double? GetLastPercent(string hardwareName)
        {
            lock (_sync)
            {
                FanBinding binding;
                string error;
                return TryResolveBindingLocked(hardwareName, out binding, out error) ? binding.LastPercent : null;
            }
        }

        public bool TrySet(string hardwareName, double percent, out string error)
        {
            lock (_sync)
            {
                FanBinding binding;
                if (!TryResolveBindingLocked(hardwareName, out binding, out error))
                    return false;

                int requested = (int)Math.Round(Math.Max(0, Math.Min(100, percent)));
                if (binding.Claimed && binding.LastPercent.HasValue && Math.Abs(binding.LastPercent.Value - requested) < 0.5)
                {
                    error = "";
                    return true;
                }
                try
                {
                    if (binding.SupportsZeroRpm)
                        Invoke(binding.FanTuning, "SetZeroRPM", requested == 0);

                    if (binding.SupportsTargetFanSpeed)
                    {
                        bool usesNestedTarget = HasProperty(binding.FanTuning, "TargetFanSpeed");
                        object targetFanSpeed = usesNestedTarget
                            ? Property(binding.FanTuning, "TargetFanSpeed")
                            : binding.FanTuning;
                        object speedRange = Property(targetFanSpeed, usesNestedTarget ? "TargetFanSpeedRange" : "SpeedRange");
                        int minimumRpm = Convert.ToInt32(Property(speedRange, "Min"));
                        int maximumRpm = Convert.ToInt32(Property(speedRange, "Max"));
                        int targetRpm = (int)Math.Round(maximumRpm * (requested / 100.0));
                        targetRpm = Math.Max(minimumRpm, Math.Min(maximumRpm, targetRpm));
                        Invoke(targetFanSpeed, "SetTargetFanSpeed", targetRpm);
                    }
                    else if (binding.SupportsFanTuningStates)
                    {
                        object fanStates = HasProperty(binding.FanTuning, "FanTuningStates")
                            ? Property(binding.FanTuning, "FanTuningStates")
                            : binding.FanTuning;
                        Invoke(fanStates, "SetFanTuningStates2", requested);
                    }
                    else
                    {
                        error = "AMD ADLX exposes no writable fan-speed method for this GPU.";
                        _lastError = error;
                        return false;
                    }

                    binding.Claimed = true;
                    binding.LastPercent = requested;
                    _lastError = "";
                    error = "";
                    return true;
                }
                catch (Exception exception)
                {
                    TryResetBindingLocked(binding);
                    error = "AMD ADLX fan write failed: " + Unwrap(exception).Message;
                    _lastError = error;
                    return false;
                }
            }
        }

        public bool TryReset(string hardwareName, out string error)
        {
            lock (_sync)
            {
                FanBinding binding;
                if (!TryResolveBindingLocked(hardwareName, out binding, out error))
                    return false;
                if (!binding.Claimed)
                {
                    error = "";
                    return true;
                }

                try
                {
                    Invoke(binding.FanTuning, "Reset");
                    binding.Claimed = false;
                    binding.LastPercent = null;
                    _lastError = "";
                    error = "";
                    return true;
                }
                catch (Exception exception)
                {
                    error = "AMD ADLX automatic-mode restore failed: " + Unwrap(exception).Message;
                    _lastError = error;
                    return false;
                }
            }
        }

        public bool TryResetAll(out string error)
        {
            lock (_sync)
            {
                List<string> errors = new List<string>();
                foreach (FanBinding binding in _bindings.Where(candidate => candidate.Claimed).ToArray())
                {
                    try
                    {
                        Invoke(binding.FanTuning, "Reset");
                        binding.Claimed = false;
                        binding.LastPercent = null;
                    }
                    catch (Exception exception)
                    {
                        errors.Add(binding.Name + ": " + Unwrap(exception).Message);
                    }
                }

                if (errors.Count > 0)
                {
                    error = "AMD ADLX automatic-mode restore failed: " + String.Join("; ", errors);
                    _lastError = error;
                    return false;
                }

                _lastError = "";
                error = "";
                return true;
            }
        }

        private bool TryResolveBindingLocked(string hardwareName, out FanBinding binding, out string error)
        {
            binding = null;
            if (!EnsureInitializedLocked())
            {
                error = _lastError;
                return false;
            }

            string normalizedName = NormalizeGpuName(hardwareName);
            binding = _bindings.FirstOrDefault(candidate => candidate.NormalizedName == normalizedName);
            if (binding == null && normalizedName.Length > 0)
            {
                binding = _bindings.FirstOrDefault(candidate =>
                    candidate.NormalizedName.Contains(normalizedName) || normalizedName.Contains(candidate.NormalizedName));
            }
            if (binding == null && _bindings.Count == 1)
                binding = _bindings[0];

            if (binding == null)
            {
                error = "AMD ADLX did not find a writable fan channel matching " + (hardwareName ?? "this GPU") + ".";
                _lastError = error;
                return false;
            }

            error = "";
            return true;
        }

        private bool EnsureInitializedLocked()
        {
            if (_disposed)
            {
                _lastError = "AMD ADLX fan control is already closed.";
                return false;
            }
            if (_initializationAttempted)
                return _bindings.Count > 0;

            _initializationAttempted = true;
            try
            {
                string baseDirectory = AppDomain.CurrentDomain.BaseDirectory;
                string wrapperPath = Path.Combine(baseDirectory, "ADLXWrapper.dll");
                string bindingsPath = Path.Combine(baseDirectory, "ADLXCSharpBind.dll");
                if (!File.Exists(wrapperPath) || !File.Exists(bindingsPath))
                    throw new FileNotFoundException("The bundled AMD ADLX fan-control libraries are missing.");

                Assembly wrapperAssembly = Assembly.LoadFrom(wrapperPath);
                Type wrapperType = wrapperAssembly.GetType("ADLXWrapper.ADLXWrapper", true);
                _wrapper = Activator.CreateInstance(wrapperType);
                MethodInfo initialize = wrapperType.GetMethod("Initialize", BindingFlags.Public | BindingFlags.Instance);
                if (initialize != null)
                    initialize.Invoke(_wrapper, null);

                _systemServices = Invoke(_wrapper, "GetSystemServices");
                _tuningService = Invoke(_systemServices, "GetGPUTuningService");
                IEnumerable gpus = Invoke(_systemServices, "GetGPUs") as IEnumerable;
                if (gpus == null)
                    throw new InvalidOperationException("AMD ADLX returned no GPU collection.");

                foreach (object gpu in gpus)
                {
                    if (!Convert.ToBoolean(Invoke(_tuningService, "IsManualFanTuningSupported", gpu)))
                    {
                        DisposeObject(gpu);
                        continue;
                    }

                    object fanTuning = Invoke(_tuningService, "GetManualFanTuning", gpu);
                    bool supportsTarget = Convert.ToBoolean(Property(fanTuning, "SupportsTargetFanSpeed"));
                    bool supportsStates = HasProperty(fanTuning, "SupportsFanTuningStates")
                        ? Convert.ToBoolean(Property(fanTuning, "SupportsFanTuningStates"))
                        : !supportsTarget;
                    if (!supportsTarget && !supportsStates)
                    {
                        DisposeObject(fanTuning);
                        DisposeObject(gpu);
                        continue;
                    }

                    int minimum = 0;
                    int maximum = 100;
                    if (supportsStates)
                    {
                        object fanStates = HasProperty(fanTuning, "FanTuningStates")
                            ? Property(fanTuning, "FanTuningStates")
                            : fanTuning;
                        object speedRange = Property(fanStates, "SpeedRange");
                        minimum = Convert.ToInt32(Property(speedRange, "Min"));
                        maximum = Convert.ToInt32(Property(speedRange, "Max"));
                    }

                    string name = Convert.ToString(Property(gpu, "Name"));
                    _bindings.Add(new FanBinding
                    {
                        Name = name,
                        NormalizedName = NormalizeGpuName(name),
                        Gpu = gpu,
                        FanTuning = fanTuning,
                        SupportsTargetFanSpeed = supportsTarget,
                        SupportsFanTuningStates = supportsStates,
                        SupportsZeroRpm = Convert.ToBoolean(Property(fanTuning, "SupportsZeroRPM")),
                        MinimumPercent = Math.Max(0, minimum),
                        MaximumPercent = Math.Min(100, Math.Max(minimum, maximum))
                    });
                }

                if (_bindings.Count == 0)
                    throw new InvalidOperationException("AMD ADLX found no GPU with manual fan tuning support.");

                _lastError = "";
                return true;
            }
            catch (Exception exception)
            {
                _lastError = "AMD ADLX initialization failed: " + Unwrap(exception).Message;
                DisposeInitializedObjectsLocked();
                return false;
            }
        }

        private static string NormalizeGpuName(string value)
        {
            if (String.IsNullOrWhiteSpace(value)) return "";
            return new string(value.ToLowerInvariant().Where(Char.IsLetterOrDigit).ToArray());
        }

        private static bool HasProperty(object target, string propertyName)
        {
            return target != null && target.GetType().GetProperty(propertyName, BindingFlags.Public | BindingFlags.Instance) != null;
        }

        private static object Property(object target, string propertyName)
        {
            if (target == null) throw new InvalidOperationException("AMD ADLX returned an empty object.");
            PropertyInfo property = target.GetType().GetProperty(propertyName, BindingFlags.Public | BindingFlags.Instance);
            if (property == null) throw new MissingMemberException(target.GetType().FullName, propertyName);
            return property.GetValue(target, null);
        }

        private static object Invoke(object target, string methodName, params object[] arguments)
        {
            if (target == null) throw new InvalidOperationException("AMD ADLX returned an empty object.");
            return target.GetType().InvokeMember(
                methodName,
                BindingFlags.Public | BindingFlags.Instance | BindingFlags.InvokeMethod,
                null,
                target,
                arguments);
        }

        private static Exception Unwrap(Exception exception)
        {
            while (exception is TargetInvocationException && exception.InnerException != null)
                exception = exception.InnerException;
            return exception;
        }

        private static void DisposeObject(object target)
        {
            IDisposable disposable = target as IDisposable;
            if (disposable != null)
            {
                try { disposable.Dispose(); } catch { }
            }
        }

        private void TryResetBindingLocked(FanBinding binding)
        {
            if (binding == null) return;
            try { Invoke(binding.FanTuning, "Reset"); } catch { }
            binding.Claimed = false;
            binding.LastPercent = null;
        }

        private void DisposeInitializedObjectsLocked()
        {
            foreach (FanBinding binding in _bindings)
            {
                if (binding.Claimed) TryResetBindingLocked(binding);
                DisposeObject(binding.FanTuning);
                DisposeObject(binding.Gpu);
            }
            _bindings.Clear();
            DisposeObject(_tuningService);
            DisposeObject(_systemServices);
            if (_wrapper != null)
            {
                try
                {
                    MethodInfo terminate = _wrapper.GetType().GetMethod("Terminate", BindingFlags.Public | BindingFlags.Instance);
                    if (terminate != null) terminate.Invoke(_wrapper, null);
                }
                catch { }
                DisposeObject(_wrapper);
            }
            _tuningService = null;
            _systemServices = null;
            _wrapper = null;
        }

        public void Dispose()
        {
            lock (_sync)
            {
                if (_disposed) return;
                _disposed = true;
                DisposeInitializedObjectsLocked();
            }
        }
    }
}
