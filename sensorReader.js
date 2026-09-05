const { spawn } = require('child_process');
const fs = require('fs');
const https = require('https');
const net = require('net');
const os = require('os');
const path = require('path');
const RTSSReader = require('./rtssReader');

const HOST_RETRY_DELAY_MS = 1500;
const HOST_SNAPSHOT_HOLD_MS = 8000;

class BuiltinSensorHostClient {
  constructor() {
    this.child = null;
    this.buffer = '';
    this.pending = new Map();
    this.nextRequestId = 1;
    this.enhanced = false;
    this.lastFailureAt = 0;
    this.lastError = '';
    this.lastSnapshot = null;
    this.lastSnapshotAt = 0;
    this.lastSnapshotEnhanced = false;
  }

  resolveExecutablePath() {
    const candidates = [];
    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, 'sensor-host', 'SiR.SensorHost.exe'));
    }
    candidates.push(path.join(__dirname, 'sensor-host', 'bin', 'SiR.SensorHost.exe'));
    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
  }

  stop(options = {}) {
    const child = this.child;
    this.child = null;
    this.buffer = '';
    this.rejectPending(new Error('Built-in sensor host stopped.'));
    if (!child) return Promise.resolve();

    const forceAfterMs = Math.max(100, Math.min(5000, Number(options.forceAfterMs) || 1000));
    return new Promise((resolve) => {
      let settled = false;
      let forceTimer = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (forceTimer) clearTimeout(forceTimer);
        resolve();
      };

      child.once('exit', finish);
      child.once('close', finish);
      try { child.stdin.end(); } catch (e) {}
      if (child.exitCode !== null || child.killed) {
        finish();
        return;
      }

      forceTimer = setTimeout(() => {
        try { child.kill(); } catch (e) {}
        setTimeout(finish, 100);
      }, forceAfterMs);
      if (forceTimer && typeof forceTimer.unref === 'function') forceTimer.unref();
    });
  }

  rejectPending(error) {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  start(enhanced) {
    if (this.child && this.enhanced === enhanced && !this.child.killed) return true;
    if (this.child) this.stop();

    const executablePath = this.resolveExecutablePath();
    if (!executablePath) {
      this.lastError = 'SiR.SensorHost.exe was not found. Run npm run sensor-host:build.';
      this.lastFailureAt = Date.now();
      return false;
    }

    try {
      const child = spawn(executablePath, enhanced ? ['--enhanced'] : [], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      this.child = child;
      this.enhanced = enhanced;
      this.buffer = '';
      this.lastError = '';

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => this.handleStdout(chunk));
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        this.lastError = `${this.lastError}\n${chunk}`.trim().slice(-4000);
      });
      child.on('error', (error) => this.handleExit(child, error));
      child.on('exit', (code) => this.handleExit(child, new Error(`Built-in sensor host exited with code ${code}.`)));
      return true;
    } catch (error) {
      this.lastError = error.message;
      this.lastFailureAt = Date.now();
      this.child = null;
      return false;
    }
  }

  handleExit(child, error) {
    if (this.child !== child) return;
    this.child = null;
    this.lastError = error.message;
    this.lastFailureAt = Date.now();
    this.rejectPending(error);
  }

  handleStdout(chunk) {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) this.handleMessage(line);
      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  handleMessage(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.lastError = `Invalid sensor host response: ${error.message}`;
      return;
    }

    if (message.type === 'ready' || message.id === undefined || message.id === null) return;
    const entry = this.pending.get(Number(message.id));
    if (!entry) return;
    this.pending.delete(Number(message.id));
    clearTimeout(entry.timer);
    if (message.ok && message.snapshot) {
      this.lastSnapshot = message.snapshot;
      this.lastSnapshotAt = Date.now();
      this.lastSnapshotEnhanced = message.snapshot?.diagnostics?.enhancedRequested === true;
      entry.resolve(message.snapshot);
    }
    else entry.reject(new Error(message.error || 'Built-in sensor host request failed.'));
  }

  getHeldSnapshot(enhanced) {
    if (!this.lastSnapshot || this.lastSnapshotEnhanced !== enhanced) return null;
    if ((Date.now() - this.lastSnapshotAt) > HOST_SNAPSHOT_HOLD_MS) return null;
    return this.lastSnapshot;
  }

  async getSnapshot(options = {}) {
    const enhanced = options.enhanced === true;
    if (!this.child && (Date.now() - this.lastFailureAt) < HOST_RETRY_DELAY_MS) {
      return this.getHeldSnapshot(enhanced);
    }
    if (!this.start(enhanced) || !this.child) return this.getHeldSnapshot(enhanced);

    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Built-in sensor host timed out.'));
      }, enhanced ? 12000 : 5000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.child.stdin.write(`${JSON.stringify({ id, command: 'snapshot' })}\n`);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    }).catch((error) => {
      const heldSnapshot = this.getHeldSnapshot(enhanced);
      if (heldSnapshot) return heldSnapshot;
      throw error;
    });
  }
}

class SensorReader {
  constructor() {
    this.rtssReader = new RTSSReader();
    this.builtinHost = new BuiltinSensorHostClient();
    this.wanIp = '';
    this.wanIpLastAttemptAt = 0;
    this.wanIpLastSuccessAt = 0;
    this.wanIpRequest = null;
    this.wanIpHttpRequest = null;
    this.wanIpRequestTimeout = null;
  }

  getPrimaryLanIp() {
    const interfaces = os.networkInterfaces();
    const candidates = [];
    Object.values(interfaces || {}).forEach((entries) => {
      (entries || []).forEach((entry) => {
        const family = typeof entry.family === 'string' ? entry.family : (entry.family === 4 ? 'IPv4' : '');
        if (family !== 'IPv4' || entry.internal || !net.isIP(entry.address)) return;
        if (String(entry.address).startsWith('169.254.')) return;
        candidates.push(String(entry.address));
      });
    });
    return candidates[0] || 'Unavailable';
  }

  refreshWanIpInBackground() {
    const now = Date.now();
    const retryAfterMs = this.wanIp ? 10 * 60 * 1000 : 60 * 1000;
    if (this.wanIpRequest || (now - this.wanIpLastAttemptAt) < retryAfterMs) return;

    this.wanIpLastAttemptAt = now;
    this.wanIpRequest = new Promise((resolve) => {
      let settled = false;
      const finish = (value = '') => {
        if (settled) return;
        settled = true;
        if (this.wanIpRequestTimeout) clearTimeout(this.wanIpRequestTimeout);
        this.wanIpRequestTimeout = null;
        this.wanIpHttpRequest = null;
        if (net.isIP(value)) {
          this.wanIp = value;
          this.wanIpLastSuccessAt = Date.now();
        }
        resolve();
      };

      const request = https.get('https://api.ipify.org', {
        headers: { 'User-Agent': 'SiR-System-Monitor/1.3.6' }
      }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          if (body.length < 1024) body += chunk;
        });
        response.on('end', () => {
          finish(String(body || '').trim());
        });
      });
      this.wanIpHttpRequest = request;
      this.wanIpRequestTimeout = setTimeout(() => {
        request.destroy();
        finish();
      }, 2500);
      request.setTimeout(2500, () => {
        request.destroy();
        finish();
      });
      request.on('error', () => finish());
    }).finally(() => {
      this.wanIpRequest = null;
    });
  }

  augmentBuiltinSnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.sensors)) return snapshot;
    this.refreshWanIpInBackground();

    const sensors = [...snapshot.sensors];
    if (!sensors.some((sensor) => sensor && sensor.id === 'builtin_os_network_lan_ip')) {
      sensors.unshift({
        id: 'builtin_os_network_lan_ip',
        name: 'Primary IP Address',
        value: this.getPrimaryLanIp(),
        units: '',
        group: 'network',
        provider: 'builtin',
        hardwareType: 'OperatingSystem',
        sensorType: 'Address',
        defaultEnabled: true
      });
    }
    sensors.unshift({
      id: 'builtin_os_network_wan_ip',
      name: 'External IP Address',
      value: this.wanIp || 'Detecting...',
      units: '',
      group: 'network',
      provider: 'builtin',
      hardwareType: 'OperatingSystem',
      sensorType: 'Address',
      defaultEnabled: true
    });
    return { ...snapshot, sensors };
  }

  async getMSIAfterburnerData(options = {}) {
    try {
      const rtssData = this.rtssReader.readRTSSExtendedData(options);
      if (rtssData) {
        return rtssData;
      }
      return null;
    } catch (e) {
      console.error('MSI Afterburner data error:', e.message);
      return null;
    }
  }

  createBuiltinProviderData(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.sensors)) return null;
    const groupedSensors = this.rtssReader.createGroupedSensorBuckets();
    groupedSensors.fps = [];
    groupedSensors.latency = [];
    const availableSensors = [];

    for (const rawSensor of snapshot.sensors) {
      if (!rawSensor || !rawSensor.id) continue;
      const numeric = Number(rawSensor.value);
      if (!Number.isFinite(numeric) && typeof rawSensor.value !== 'string') continue;
      const group = groupedSensors[rawSensor.group] ? rawSensor.group : 'other';
      const sensor = {
        id: String(rawSensor.id),
        name: String(rawSensor.name || rawSensor.id),
        value: Number.isFinite(numeric) ? numeric : rawSensor.value,
        units: String(rawSensor.units || ''),
        group,
        provider: 'builtin',
        hardwareType: String(rawSensor.hardwareType || ''),
        sensorType: String(rawSensor.sensorType || ''),
        defaultEnabled: rawSensor.defaultEnabled !== false
      };
      groupedSensors[group].push(sensor);
      availableSensors.push(sensor);
    }

    const findSensor = (group, predicate) => (groupedSensors[group] || []).find(predicate);
    const valueOf = (sensor) => {
      const value = Number(sensor && sensor.value);
      return Number.isFinite(value) ? value : null;
    };
    const positiveValueOf = (sensor) => {
      const value = valueOf(sensor);
      return value !== null && value > 0 ? value : null;
    };
    const byId = (id) => availableSensors.find((sensor) => sensor.id === id);
    const byName = (group, pattern, units = '') => findSensor(group, (sensor) => {
      const unitMatch = !units || String(sensor.units).toLowerCase() === units.toLowerCase();
      return unitMatch && pattern.test(String(sensor.name || ''));
    });
    const byType = (group, sensorType) => (groupedSensors[group] || []).filter((sensor) =>
      String(sensor.sensorType || '').toLowerCase() === String(sensorType || '').toLowerCase()
    );

    const fpsSensor = byName('fps', /\bfps\b/i, 'FPS');
    const frameTimeSensor = byName('fps', /frame\s*time|frametime/i, 'ms');
    const fanSpeeds = (groupedSensors.fans || [])
      .filter((sensor) => String(sensor.units).toLowerCase() === 'rpm')
      .map((sensor) => ({ name: sensor.name, value: sensor.value, units: sensor.units }));
    const cpuPowerSensors = byType('cpu', 'Power');
    const cpuPackagePowerSensor = cpuPowerSensors.find((sensor) => /package/i.test(String(sensor.name || ''))) || cpuPowerSensors[0];

    return {
      fps: valueOf(fpsSensor) || 0,
      frameTime: valueOf(frameTimeSensor) || 0,
      cpuTemp: positiveValueOf(byName('cpu', /tctl|tdie|package|cpu.*temp/i, 'C')),
      cpuLoad: valueOf(byId('builtin_os_cpu_load')),
      cpuPower: valueOf(cpuPackagePowerSensor),
      cpuFreq: positiveValueOf(byName('cpu', /average|cpu.*clock|cpu.*frequency/i, 'MHz')),
      gpuTemp: positiveValueOf(byName('gpu', /gpu core|gpu.*temp/i, 'C')),
      gpuLoad: valueOf(byName('gpu', /gpu core|gpu.*load/i, '%')),
      gpuMemory: valueOf(byName('gpu', /gpu memory used/i)),
      gpuPower: valueOf(byName('gpu', /gpu package|gpu.*power/i, 'W')),
      gpuFreq: positiveValueOf(byName('gpu', /gpu core|gpu.*clock/i, 'MHz')),
      ramUsage: valueOf(byId('builtin_os_memory_load')),
      psuTemp: positiveValueOf(byName('psu', /temp/i, 'C')),
      fanSpeeds,
      availableSensors,
      groupedSensors,
      timestamp: Number(snapshot.timestamp) || Date.now(),
      source: snapshot.diagnostics && snapshot.diagnostics.enhancedAvailable ? 'builtin+enhanced' : 'builtin',
      diagnostics: snapshot.diagnostics || {}
    };
  }

  mergeProviderData(builtinData, externalData) {
    if (!builtinData) return externalData || null;
    if (!externalData) return builtinData;

    const firstAvailable = (...values) => {
      for (const value of values) {
        if (value !== null && value !== undefined && !(typeof value === 'number' && Number.isNaN(value))) return value;
      }
      return null;
    };
    const groupedSensors = this.rtssReader.mergeCatalogs(builtinData.groupedSensors, externalData.groupedSensors);
    const availableSensors = this.rtssReader.flattenGroupedCatalog(groupedSensors);

    return {
      fps: firstAvailable(externalData.fps > 0 ? externalData.fps : null, builtinData.fps, 0) || 0,
      frameTime: firstAvailable(externalData.frameTime > 0 ? externalData.frameTime : null, builtinData.frameTime, 0) || 0,
      frameTimeDebug: externalData.frameTimeDebug || null,
      cpuTemp: firstAvailable(builtinData.cpuTemp, externalData.cpuTemp),
      cpuLoad: firstAvailable(builtinData.cpuLoad, externalData.cpuLoad),
      cpuPower: firstAvailable(builtinData.cpuPower, externalData.cpuPower),
      cpuFreq: firstAvailable(builtinData.cpuFreq, externalData.cpuFreq),
      gpuTemp: firstAvailable(builtinData.gpuTemp, externalData.gpuTemp),
      gpuLoad: firstAvailable(builtinData.gpuLoad, externalData.gpuLoad),
      gpuMemory: firstAvailable(builtinData.gpuMemory, externalData.gpuMemory),
      gpuPower: firstAvailable(builtinData.gpuPower, externalData.gpuPower),
      gpuFreq: firstAvailable(builtinData.gpuFreq, externalData.gpuFreq),
      ramUsage: firstAvailable(builtinData.ramUsage, externalData.ramUsage),
      psuTemp: firstAvailable(builtinData.psuTemp, externalData.psuTemp),
      fanSpeeds: builtinData.fanSpeeds && builtinData.fanSpeeds.length ? builtinData.fanSpeeds : (externalData.fanSpeeds || []),
      availableSensors,
      groupedSensors,
      timestamp: Date.now(),
      source: [builtinData.source, externalData.source].filter(Boolean).join('+'),
      diagnostics: builtinData.diagnostics || {}
    };
  }

  async getEnhancedData(mode = 'wmi', opts = {}) {
    try {
      const providers = opts.providers || {};
      const useBuiltin = providers.builtin !== false;
      const useExternal = providers.rtss === true || providers.aida64 === true || providers.hwinfo === true;
      if (!useBuiltin && this.builtinHost) this.builtinHost.stop();

      const [snapshot, externalData] = await Promise.all([
        useBuiltin
          ? this.builtinHost.getSnapshot({ enhanced: providers.enhanced === true }).catch((error) => {
            console.debug(`Built-in sensor host failed: ${error.message}`);
            return null;
          })
          : Promise.resolve(null),
        useExternal
          ? this.getMSIAfterburnerData({ providers })
          : Promise.resolve(null)
      ]);
      const builtinData = this.createBuiltinProviderData(this.augmentBuiltinSnapshot(snapshot));
      const external = this.mergeProviderData(builtinData, externalData);
      return {
        cpu: null,
        gpu: null,
        fans: null,
        psu: null,
        motherboard: null,
        external,
        memory: null,
        system: null
      };
    } catch (e) {
      console.error('Error getting enhanced data:', e);
      return null;
    }
  }

  close(options = {}) {
    const hostStop = this.builtinHost ? this.builtinHost.stop(options) : Promise.resolve();
    if (this.wanIpRequestTimeout) clearTimeout(this.wanIpRequestTimeout);
    this.wanIpRequestTimeout = null;
    if (this.wanIpHttpRequest) {
      try { this.wanIpHttpRequest.destroy(); } catch (_error) {}
    }
    this.wanIpHttpRequest = null;
    return hostStop;
  }
}

module.exports = SensorReader;
