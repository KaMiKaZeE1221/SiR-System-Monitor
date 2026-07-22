const { execFileSync } = require('child_process');
const os = require('os');
const SensorReader = require('../sensorReader');

const enhanced = process.argv.includes('--enhanced');
const durationArg = process.argv.find((arg) => /^--seconds=\d+$/.test(arg));
const durationSeconds = durationArg ? Math.max(3, Number(durationArg.split('=')[1])) : 10;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function readProcessStats(pid) {
  const command = `$p=Get-Process -Id ${Number(pid)} -ErrorAction Stop; @{cpuMs=$p.TotalProcessorTime.TotalMilliseconds; workingSet=$p.WorkingSet64} | ConvertTo-Json -Compress`;
  return JSON.parse(execFileSync('powershell', ['-NoProfile', '-Command', command], { encoding: 'utf8' }).trim());
}

async function main() {
  const reader = new SensorReader();
  const providers = { builtin: true, enhanced, rtss: false, aida64: false, hwinfo: false };
  try {
    await reader.getEnhancedData('builtin', { providers });
    await wait(1000);
    const pid = reader.builtinHost && reader.builtinHost.child && reader.builtinHost.child.pid;
    if (!pid) throw new Error('Built-in sensor host did not start.');

    const before = readProcessStats(pid);
    const startedAt = Date.now();
    const latencies = [];
    for (let index = 0; index < durationSeconds; index += 1) {
      const requestStartedAt = Date.now();
      await reader.getEnhancedData('builtin', { providers });
      latencies.push(Date.now() - requestStartedAt);
      const nextDueAt = startedAt + ((index + 1) * 1000);
      await wait(Math.max(0, nextDueAt - Date.now()));
    }
    const elapsedMs = Date.now() - startedAt;
    const after = readProcessStats(pid);
    const cpuMs = Math.max(0, Number(after.cpuMs) - Number(before.cpuMs));
    const logicalProcessors = Math.max(1, os.cpus().length);
    const sortedLatency = [...latencies].sort((a, b) => a - b);
    const percentile95 = sortedLatency[Math.min(sortedLatency.length - 1, Math.floor(sortedLatency.length * 0.95))];

    console.log(JSON.stringify({
      enhanced,
      durationSeconds: Math.round((elapsedMs / 1000) * 10) / 10,
      samples: latencies.length,
      hostCpuPercentOfMachine: Math.round(((cpuMs / elapsedMs) * 100 / logicalProcessors) * 1000) / 1000,
      hostCpuPercentOfOneCore: Math.round(((cpuMs / elapsedMs) * 100) * 100) / 100,
      hostWorkingSetMb: Math.round((Number(after.workingSet) / 1024 / 1024) * 10) / 10,
      requestLatencyAverageMs: Math.round((latencies.reduce((sum, value) => sum + value, 0) / latencies.length) * 10) / 10,
      requestLatencyP95Ms: percentile95
    }, null, 2));
  } finally {
    reader.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
