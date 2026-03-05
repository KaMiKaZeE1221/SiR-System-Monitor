const koffi = require('koffi');

/**
 * RTSS (RivaTuner Statistics Server) shared memory reader
 * Reads FPS, GPU, and sensor data from RTSS shared memory
 */

class RTSSReader {
  constructor() {
    try {
      this.kernel32 = koffi.load('kernel32.dll');
      this.msvcrt = koffi.load('msvcrt.dll');  // C runtime for memcpy
      this.user32 = koffi.load('user32.dll');
      this.initialized = true;

      this.HWINFO_MAP = 'Global\\HWiNFO_SENS_SM2';
      this.LHM_MAP = 'LHMDPSharedMemory';
      this.AIDA_MAP = 'AIDA64_SensorValues';
      this.HWINFO_MAP_ALIASES = ['Global\\HWiNFO_SENS_SM2', 'HWiNFO_SENS_SM2'];
      this.LHM_MAP_ALIASES = ['LHMDPSharedMemory', 'Global\\LHMDPSharedMemory', 'Local\\LHMDPSharedMemory'];
      this.AIDA_MAP_ALIASES = ['AIDA64_SensorValues', 'Global\\AIDA64_SensorValues', 'Local\\AIDA64_SensorValues'];

      this.MAHM_SIG = 0x4D48414D; // 'MAHM' little-endian

      this.MAHM_SOURCE_IDS = {
        GPU_TEMPERATURE: 0x00000000,
        GPU_USAGE: 0x00000030,
        MEMORY_USAGE: 0x00000031,
        CORE_CLOCK: 0x00000020,
        GPU_REL_POWER: 0x00000060,
        GPU_ABS_POWER: 0x00000061,
        CPU_TEMPERATURE: 0x00000080,
        CPU_USAGE: 0x00000090,
        RAM_USAGE: 0x00000091,
        CPU_CLOCK: 0x000000A0,
        CPU_POWER: 0x00000100,
        FAN_SPEED: 0x00000010,
        FAN_TACHOMETER: 0x00000011,
        FAN_SPEED2: 0x00000012,
        FAN_TACHOMETER2: 0x00000013,
        FAN_SPEED3: 0x00000014,
        FAN_TACHOMETER3: 0x00000015,
        FRAMERATE: 0x00000050,
        FRAMETIME: 0x00000051,
        PLUGIN_PSU: 0x000000F6
      };

      this.providerFallbackTtlMs = 1500;
      this.aidaReadRetryCount = 3;
      this.aidaReadRetryDelayMs = 15;
      this.lastAidaSnapshot = null;
      this.lastAidaSnapshotAt = 0;
    } catch (e) {
      this.initialized = false;
    }
  }

  getCachedAidaSnapshot() {
    if (!this.lastAidaSnapshot || !this.lastAidaSnapshotAt) return null;
    if ((Date.now() - this.lastAidaSnapshotAt) > this.providerFallbackTtlMs) return null;
    return this.lastAidaSnapshot;
  }

  sleepMs(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return;
    try {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(1, Math.floor(ms)));
    } catch (e) {}
  }

  readCString(buffer, offset, maxLen) {
    const bytes = [];
    const end = Math.min(buffer.length, offset + maxLen);
    for (let i = offset; i < end; i++) {
      const b = buffer[i];
      if (b === 0) break;
      bytes.push(b);
    }
    return Buffer.from(bytes).toString('utf8').trim();
  }

  readWideCString(buffer, offset, maxLenBytes) {
    const end = Math.min(buffer.length, offset + maxLenBytes);
    let stop = end;
    for (let i = offset; i + 1 < end; i += 2) {
      if (buffer[i] === 0 && buffer[i + 1] === 0) {
        stop = i;
        break;
      }
    }
    if (stop <= offset) return '';
    return buffer.slice(offset, stop).toString('utf16le').trim();
  }

  readXmlLikeText(buffer, maxLenBytes) {
    const utf8 = this.readCString(buffer, 0, maxLenBytes);
    if (utf8 && utf8.includes('<') && utf8.includes('>')) return utf8;

    const utf16 = this.readWideCString(buffer, 0, maxLenBytes);
    if (utf16 && utf16.includes('<') && utf16.includes('>')) return utf16;

    return utf8 || utf16 || '';
  }

  copySharedMemoryAny(mappingNames, size) {
    for (const mapName of mappingNames || []) {
      const buf = this.copySharedMemory(mapName, size);
      if (buf) return { mapName, buffer: buf };
    }
    return null;
  }

  copySharedMemoryFlexible(mappingNames, sizes) {
    for (const size of sizes || []) {
      const opened = this.copySharedMemoryAny(mappingNames, size);
      if (opened && opened.buffer) return opened;
    }
    return null;
  }

  copySharedMemory(mappingName, size) {
    const OpenFileMappingA = this.kernel32.func('void* __stdcall OpenFileMappingA(uint, bool, str)');
    const MapViewOfFile = this.kernel32.func('void* __stdcall MapViewOfFile(void*, uint, uint, uint, uint)');
    const UnmapViewOfFile = this.kernel32.func('bool __stdcall UnmapViewOfFile(void*)');
    const CloseHandle = this.kernel32.func('bool __stdcall CloseHandle(void*)');
    const memcpy = this.msvcrt.func('void* __cdecl memcpy(void*, void*, uint)');

    const hMapFile = OpenFileMappingA(2, false, mappingName); // FILE_MAP_READ
    if (!hMapFile) return null;

    const pBuf = MapViewOfFile(hMapFile, 2, 0, 0, size);
    if (!pBuf) {
      CloseHandle(hMapFile);
      return null;
    }

    try {
      const tempBuf = Buffer.alloc(size);
      memcpy(tempBuf, pBuf, size);
      return tempBuf;
    } finally {
      UnmapViewOfFile(pBuf);
      CloseHandle(hMapFile);
    }
  }

  readRTSSHeader(mappingName) {
    const headerBuf = this.copySharedMemory(mappingName, 4096);
    if (!headerBuf) return null;

    const dv = new DataView(headerBuf.buffer, headerBuf.byteOffset, headerBuf.length);
    const signature = dv.getUint32(0, true);
    const version = dv.getUint32(4, true);

    return {
      signature,
      version,
      dwAppEntrySize: dv.getUint32(8, true),
      dwAppArrOffset: dv.getUint32(12, true),
      dwAppArrSize: dv.getUint32(16, true),
      dwOSDEntrySize: dv.getUint32(20, true),
      dwOSDArrOffset: dv.getUint32(24, true),
      dwOSDArrSize: dv.getUint32(28, true)
    };
  }

  parseNumberFromLine(line) {
    if (!line) return null;
    const match = line.match(/(-?\d+(?:\.\d+)?)/);
    if (!match) return null;
    const val = parseFloat(match[1]);
    return Number.isFinite(val) ? val : null;
  }

  classifySensorGroup(name, units, srcId) {
    const lowerName = (name || '').toLowerCase();
    const lowerUnits = (units || '').toLowerCase();

    if (lowerName.includes('fan') || lowerUnits.includes('rpm')) return 'fans';
    if (
      lowerName.includes('psu') ||
      lowerName.includes('power supply') ||
      lowerName.includes('+12 v') ||
      lowerName.includes('+5 v') ||
      lowerName.includes('+3.3 v') ||
      lowerName.includes('3vsb') ||
      lowerName.includes('vbat')
    ) return 'psu';
    if (lowerName.includes('nic') || lowerName.includes('network') || lowerName.includes('ethernet') || lowerName.includes('wi-fi') || lowerName.includes('wifi') || lowerName.includes('upload') || lowerName.includes('download') || lowerName.includes('ip address') || lowerName.includes('connection speed')) return 'network';
    if (lowerName.includes('drive') || lowerName.includes('disk') || lowerName.includes('storage') || lowerName.includes('nvme') || lowerName.includes('ssd') || lowerName.includes('hdd') || lowerName.includes('read speed') || lowerName.includes('write speed')) return 'drives';
    if (lowerName.includes('cpu') || srcId === this.MAHM_SOURCE_IDS.CPU_TEMPERATURE || srcId === this.MAHM_SOURCE_IDS.CPU_USAGE || srcId === this.MAHM_SOURCE_IDS.CPU_POWER || srcId === this.MAHM_SOURCE_IDS.CPU_CLOCK) return 'cpu';
    if (lowerName.includes('gpu') || srcId === this.MAHM_SOURCE_IDS.GPU_TEMPERATURE || srcId === this.MAHM_SOURCE_IDS.GPU_USAGE || srcId === this.MAHM_SOURCE_IDS.MEMORY_USAGE || srcId === this.MAHM_SOURCE_IDS.CORE_CLOCK || srcId === this.MAHM_SOURCE_IDS.GPU_ABS_POWER || srcId === this.MAHM_SOURCE_IDS.GPU_REL_POWER) return 'gpu';
    if ((lowerName.includes('ram') || lowerName.includes('memory') || lowerName.includes('dimm') || lowerName.includes('dram')) && !lowerName.includes('gpu')) return 'ram';
    return 'other';
  }

  createGroupedSensorBuckets() {
    return {
      cpu: [],
      gpu: [],
      ram: [],
      psu: [],
      fans: [],
      network: [],
      drives: [],
      other: []
    };
  }

  mergeCatalogs(baseCatalog, extraCatalog) {
    const merged = this.createGroupedSensorBuckets();
    const all = [baseCatalog || this.createGroupedSensorBuckets(), extraCatalog || this.createGroupedSensorBuckets()];
    const seen = new Set();

    for (const catalog of all) {
      for (const [group, sensors] of Object.entries(catalog)) {
        if (!merged[group]) merged[group] = [];
        for (const sensor of (sensors || [])) {
          if (!sensor || !sensor.id) continue;
          if (seen.has(sensor.id)) continue;
          seen.add(sensor.id);
          merged[group].push(sensor);
        }
      }
    }

    return merged;
  }

  flattenGroupedCatalog(grouped) {
    const all = [];
    Object.values(grouped || {}).forEach((list) => {
      (list || []).forEach((sensor) => all.push(sensor));
    });
    return all;
  }

  extractOSDLineEntries(text) {
    const lineMatches = [...text.matchAll(/<L(\d+)>/g)];
    const lineEntries = [];

    for (let i = 0; i < lineMatches.length; i++) {
      const lineNo = parseInt(lineMatches[i][1], 10);
      const start = lineMatches[i].index + lineMatches[i][0].length;
      const end = (i + 1 < lineMatches.length) ? lineMatches[i + 1].index : text.length;
      const segment = text.slice(start, end);
      const cleanedLine = segment.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      if (cleanedLine) {
        lineEntries.push({ lineNo, text: cleanedLine });
      }
    }

    return lineEntries;
  }

  buildCatalogFromOSDLines(lineEntries) {
    const grouped = this.createGroupedSensorBuckets();
    const add = (group, sensor) => {
      if (!grouped[group]) grouped[group] = [];
      grouped[group].push(sensor);
    };

    for (const entry of (lineEntries || [])) {
      const text = entry.text || '';
      const value = this.parseNumberFromLine(text);
      if (value === null) continue;

      const lower = text.toLowerCase();
      if (/^(fps|cpu|gpu|frametime)\s*:?$/.test(lower) || lower === 'ms') continue;

      const unitMatch = lower.match(/(rpm|mhz|ghz|gb|mb|w|c|%|ms)\b/);
      const units = unitMatch ? unitMatch[1].toUpperCase() : '';

      const nameMatch = text.match(/^([a-zA-Z][a-zA-Z0-9\s_\-\/]*?)\s*[:=]/);
      const inferredName = nameMatch ? nameMatch[1].trim() : `OSD Sensor L${entry.lineNo}`;
      const id = `osd_l${entry.lineNo}_${inferredName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
      const group = this.classifySensorGroup(inferredName, units, -1);

      add(group, {
        id,
        name: inferredName,
        value,
        units,
        group,
        lineNo: entry.lineNo
      });
    }

    return grouped;
  }

  buildGroupedFromParsedMetrics(metrics) {
    const grouped = this.createGroupedSensorBuckets();
    const pushSensor = (group, id, name, value, units) => {
      if (value === null || value === undefined || !Number.isFinite(Number(value))) return;
      grouped[group].push({ id, name, value: Number(value), units, group });
    };

    pushSensor('cpu', 'cpu_load', 'CPU Load', metrics.cpuLoad, '%');
    pushSensor('cpu', 'cpu_temp', 'CPU Temperature', metrics.cpuTemp, 'C');
    pushSensor('cpu', 'cpu_power', 'CPU Power', metrics.cpuPower, 'W');
    pushSensor('cpu', 'cpu_freq', 'CPU Frequency', metrics.cpuFreq, 'MHz');

    pushSensor('gpu', 'gpu_load', 'GPU Load', metrics.gpuLoad, '%');
    pushSensor('gpu', 'gpu_temp', 'GPU Temperature', metrics.gpuTemp, 'C');
    pushSensor('gpu', 'gpu_power', 'GPU Power', metrics.gpuPower, 'W');
    pushSensor('gpu', 'gpu_freq', 'GPU Frequency', metrics.gpuFreq, 'MHz');
    pushSensor('gpu', 'gpu_memory', 'GPU Memory', metrics.gpuMemory, 'GB');

    pushSensor('psu', 'psu_temp', 'PSU Temperature', metrics.psuTemp, 'C');

    if (Array.isArray(metrics.fanSpeeds)) {
      metrics.fanSpeeds.forEach((fan, idx) => {
        pushSensor('fans', `fan_${idx + 1}`, fan.name || `Fan ${idx + 1}`, fan.value, fan.units || '');
      });
    }

    const allSensors = [];
    Object.values(grouped).forEach((list) => allSensors.push(...list));
    return { groupedSensors: grouped, availableSensors: allSensors };
  }

  createProviderResult(provider) {
    return {
      provider,
      cpuTemp: null,
      cpuLoad: null,
      cpuPower: null,
      cpuFreq: null,
      gpuTemp: null,
      gpuLoad: null,
      gpuMemory: null,
      gpuPower: null,
      gpuFreq: null,
      ramUsage: null,
      psuTemp: null,
      fanSpeeds: [],
      availableSensors: [],
      groupedSensors: this.createGroupedSensorBuckets(),
      timestamp: Date.now()
    };
  }

  normalizeMemoryValue(value, units) {
    if (!Number.isFinite(value)) return value;
    const u = (units || '').toLowerCase();
    if (u === 'mb') return value / 1024;
    if (u === 'kb') return value / (1024 * 1024);
    return value;
  }

  addProviderSensor(result, sensor) {
    if (!sensor || !sensor.id) return;
    if (!result.groupedSensors[sensor.group]) {
      result.groupedSensors[sensor.group] = [];
    }
    result.groupedSensors[sensor.group].push(sensor);
    result.availableSensors.push(sensor);
  }

  mapCommonMetrics(result, name, units, value) {
    const lower = (name || '').toLowerCase();
    const lowerUnits = (units || '').toLowerCase();

    if (result.cpuTemp === null && lower.includes('cpu') && lower.includes('temp')) result.cpuTemp = value;
    if (result.cpuLoad === null && lower.includes('cpu') && (lower.includes('load') || lower.includes('usage')) && lowerUnits.includes('%')) result.cpuLoad = value;
    if (result.cpuPower === null && lower.includes('cpu') && lower.includes('power')) result.cpuPower = value;
    if (result.cpuFreq === null && lower.includes('cpu') && (lower.includes('clock') || lower.includes('freq'))) result.cpuFreq = value;

    if (result.gpuTemp === null && lower.includes('gpu') && lower.includes('temp')) result.gpuTemp = value;
    if (result.gpuLoad === null && lower.includes('gpu') && (lower.includes('load') || lower.includes('usage')) && lowerUnits.includes('%')) result.gpuLoad = value;
    if (result.gpuPower === null && lower.includes('gpu') && lower.includes('power')) result.gpuPower = value;
    if (result.gpuFreq === null && lower.includes('gpu') && (lower.includes('clock') || lower.includes('freq'))) result.gpuFreq = value;

    const isGpuMemoryLike = lower.includes('gpu') && (lower.includes('memory') || lower.includes('vram'));
    const isClockLike = lower.includes('clock') || lower.includes('freq') || lower.includes('speed');
    const hasMemoryUnits = lowerUnits.includes('gb') || lowerUnits.includes('mb') || lowerUnits.includes('kb');
    const isUsageLike = lower.includes('used') || lower.includes('usage') || lower.includes('dedicated') || lower.includes('dynamic') || lower.includes('vram');
    if (result.gpuMemory === null && isGpuMemoryLike && !isClockLike && (hasMemoryUnits || isUsageLike)) {
      if (hasMemoryUnits) {
        result.gpuMemory = this.normalizeMemoryValue(value, units);
      } else if (lower.includes('dedicated') || lower.includes('dynamic') || lower.includes('used')) {
        result.gpuMemory = value / 1024;
      }
    }
    if (result.ramUsage === null && (lower.includes('ram') || lower.includes('memory used') || lower.includes('physical memory')) && !lower.includes('gpu')) {
      result.ramUsage = this.normalizeMemoryValue(value, units);
    }
    if (result.psuTemp === null && (lower.includes('psu') || lower.includes('power supply')) && lower.includes('temp')) {
      result.psuTemp = value;
    }

    if (lower.includes('fan') && (lowerUnits.includes('rpm') || lowerUnits.includes('%'))) {
      result.fanSpeeds.push({
        name: name,
        value,
        units: units
      });
    }
  }

  parseNumericValueAndUnits(rawText, fallbackUnits = '') {
    const text = String(rawText || '').trim();
    const numberMatch = text.match(/(-?\d+(?:[\.,]\d+)?)/);
    if (!numberMatch) return null;

    const value = parseFloat(numberMatch[1].replace(',', '.'));
    if (!Number.isFinite(value)) return null;

    const lower = text.toLowerCase();
    let units = fallbackUnits || '';
    if (/%/.test(text)) units = '%';
    else if (/rpm/.test(lower)) units = 'RPM';
    else if (/ghz/.test(lower)) units = 'GHz';
    else if (/mhz/.test(lower)) units = 'MHz';
    else if (/mb/.test(lower)) units = 'MB';
    else if (/gb/.test(lower)) units = 'GB';
    else if (/\bw\b|watt/.test(lower)) units = 'W';
    else if (/°c|\bc\b/.test(lower)) units = 'C';

    let normalizedValue = value;
    if (units === 'GHz') {
      normalizedValue = value * 1000;
      units = 'MHz';
    }

    return { value: normalizedValue, units };
  }

  readAIDA64SharedMemory() {
    if (!this.initialized) return null;

    try {
      let xml = '';
      const maxAttempts = Math.max(1, Number(this.aidaReadRetryCount) || 1);
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const openedMap = this.copySharedMemoryFlexible(
          this.AIDA_MAP_ALIASES || [this.AIDA_MAP],
          [2 * 1024 * 1024, 1024 * 1024, 512 * 1024, 256 * 1024, 128 * 1024, 64 * 1024, 32 * 1024, 16 * 1024, 8 * 1024, 4096]
        );

        if (openedMap && openedMap.buffer) {
          const text = this.readXmlLikeText(openedMap.buffer, openedMap.buffer.length);
          if (text && text.length >= 20 && text.includes('<') && text.includes('</')) {
            xml = text;
            break;
          }
        }

        if (attempt < (maxAttempts - 1)) {
          this.sleepMs(this.aidaReadRetryDelayMs);
        }
      }

      if (!xml) return this.getCachedAidaSnapshot();

      const result = this.createProviderResult('aida');
      const entryRegex = /<([a-zA-Z0-9_]+)>[\s\S]*?<id>([\s\S]*?)<\/id>[\s\S]*?<label>([\s\S]*?)<\/label>[\s\S]*?<value>([\s\S]*?)<\/value>[\s\S]*?<\/\1>/gi;

      for (const match of xml.matchAll(entryRegex)) {
        const sensorType = (match[1] || '').trim();
        const sensorId = (match[2] || '').trim();
        const label = (match[3] || '').trim();
        const valueRaw = (match[4] || '').trim();
        if (!sensorId || !valueRaw) continue;

        const fullName = label || sensorId;
        const lowerFullName = fullName.toLowerCase();

        if (lowerFullName.includes('ip address')) {
          const groupForIp = this.classifySensorGroup(`${sensorType} ${fullName}`, '', -1);
          this.addProviderSensor(result, {
            id: `aida_${sensorType}_${sensorId}`.replace(/[^a-zA-Z0-9_\-]/g, '_'),
            name: fullName,
            value: valueRaw,
            units: '',
            group: groupForIp,
            provider: 'aida',
            sourceType: sensorType,
            sourceId: sensorId
          });
          continue;
        }

        if (lowerFullName.includes('desktop resolution') || lowerFullName.includes('resolution')) {
          const groupForResolution = this.classifySensorGroup(`${sensorType} ${fullName}`, '', -1);
          this.addProviderSensor(result, {
            id: `aida_${sensorType}_${sensorId}`.replace(/[^a-zA-Z0-9_\-]/g, '_'),
            name: fullName,
            value: valueRaw,
            units: '',
            group: groupForResolution,
            provider: 'aida',
            sourceType: sensorType,
            sourceId: sensorId
          });
          continue;
        }

        if ((lowerFullName.includes('time') && !lowerFullName.includes('frame time') && !lowerFullName.includes('frametime') && valueRaw.includes(':')) || lowerFullName.includes('time (hh:mm)')) {
          const groupForTime = this.classifySensorGroup(`${sensorType} ${fullName}`, '', -1);
          this.addProviderSensor(result, {
            id: `aida_${sensorType}_${sensorId}`.replace(/[^a-zA-Z0-9_\-]/g, '_'),
            name: fullName,
            value: valueRaw,
            units: '',
            group: groupForTime,
            provider: 'aida',
            sourceType: sensorType,
            sourceId: sensorId
          });
          continue;
        }

        if (lowerFullName.includes('motherboard name')) {
          const groupForBoardName = this.classifySensorGroup(`${sensorType} ${fullName}`, '', -1);
          this.addProviderSensor(result, {
            id: `aida_${sensorType}_${sensorId}`.replace(/[^a-zA-Z0-9_\-]/g, '_'),
            name: fullName,
            value: valueRaw,
            units: '',
            group: groupForBoardName,
            provider: 'aida',
            sourceType: sensorType,
            sourceId: sensorId
          });
          continue;
        }

        const parsed = this.parseNumericValueAndUnits(valueRaw);
        if (!parsed) continue;

        const upperSensorId = sensorId.toUpperCase();
        const isDriveTempSensor = /^THDD\d+(?:TS\d+)?$/.test(upperSensorId);
        const group = (upperSensorId.includes('PSU') || fullName.toLowerCase().includes('power supply'))
          ? 'psu'
          : (isDriveTempSensor ? 'drives' : this.classifySensorGroup(`${sensorType} ${fullName}`, parsed.units, -1));
        const normalizedValue = (group === 'ram' || (group === 'gpu' && fullName.toLowerCase().includes('memory')))
          ? this.normalizeMemoryValue(parsed.value, parsed.units)
          : parsed.value;

        this.addProviderSensor(result, {
          id: `aida_${sensorType}_${sensorId}`.replace(/[^a-zA-Z0-9_\-]/g, '_'),
          name: fullName,
          value: normalizedValue,
          units: parsed.units,
          group,
          provider: 'aida',
          sourceType: sensorType,
          sourceId: sensorId
        });

        this.mapCommonMetrics(result, fullName, parsed.units, normalizedValue);
      }

      if (!result.availableSensors.length) return this.getCachedAidaSnapshot();
      this.lastAidaSnapshot = result;
      this.lastAidaSnapshotAt = Date.now();
      return result;
    } catch (e) {
      return this.getCachedAidaSnapshot();
    }
  }

  readHWiNFOSharedMemory() {
    if (!this.initialized) return null;

    try {
      const headerMap = this.copySharedMemoryAny(this.HWINFO_MAP_ALIASES || [this.HWINFO_MAP], 4096);
      const headerBuf = headerMap ? headerMap.buffer : null;
      if (!headerBuf) return null;

      const headerDv = new DataView(headerBuf.buffer, headerBuf.byteOffset, headerBuf.length);
      const offsetSensor = headerDv.getUint32(20, true);
      const sizeSensor = headerDv.getUint32(24, true);
      const numSensor = headerDv.getUint32(28, true);
      const offsetReading = headerDv.getUint32(32, true);
      const sizeReading = headerDv.getUint32(36, true);
      const numReading = headerDv.getUint32(40, true);

      if (!offsetReading || !sizeReading || !numReading) return null;

      const requiredSize = Math.min(Math.max(offsetReading + (sizeReading * numReading), 65536), 32 * 1024 * 1024);
      const fullMap = this.copySharedMemoryAny(this.HWINFO_MAP_ALIASES || [this.HWINFO_MAP], requiredSize);
      const buf = fullMap ? fullMap.buffer : null;
      if (!buf) return null;

      const dv = new DataView(buf.buffer, buf.byteOffset, buf.length);
      const result = this.createProviderResult('hwinfo');

      const sensorsByIndex = new Map();
      for (let i = 0; i < numSensor; i++) {
        const base = offsetSensor + i * sizeSensor;
        if (base + sizeSensor > buf.length) break;
        const sensorInst = dv.getUint32(base + 4, true);
        const sensorNameOrig = this.readCString(buf, base + 8, 128);
        const sensorNameUser = this.readCString(buf, base + 136, 128);
        sensorsByIndex.set(i, {
          sensorInst,
          name: sensorNameUser || sensorNameOrig || `Sensor ${i}`
        });
      }

      for (let i = 0; i < numReading; i++) {
        const base = offsetReading + i * sizeReading;
        if (base + sizeReading > buf.length) break;

        const sensorIndex = dv.getUint32(base + 4, true);
        const readingId = dv.getUint32(base + 8, true);
        const labelOrig = this.readCString(buf, base + 12, 128);
        const labelUser = this.readCString(buf, base + 140, 128);
        const unit = this.readCString(buf, base + 268, 16);
        const value = dv.getFloat64(base + 284, true);
        if (!Number.isFinite(value)) continue;

        const sensorMeta = sensorsByIndex.get(sensorIndex);
        const sensorName = sensorMeta ? sensorMeta.name : `Sensor ${sensorIndex}`;
        const readingName = labelUser || labelOrig || `Reading ${readingId}`;
        const fullName = `${sensorName} ${readingName}`.trim();

        const group = this.classifySensorGroup(fullName, unit, -1);
        const id = `hwinfo_${sensorMeta ? sensorMeta.sensorInst : sensorIndex}_${readingId}`;
        const normalizedValue = (group === 'ram' || (group === 'gpu' && fullName.toLowerCase().includes('memory')))
          ? this.normalizeMemoryValue(value, unit)
          : value;

        this.addProviderSensor(result, {
          id,
          name: fullName,
          value: normalizedValue,
          units: unit,
          group,
          provider: 'hwinfo'
        });

        this.mapCommonMetrics(result, fullName, unit, normalizedValue);
      }

      if (!result.availableSensors.length) return null;
      return result;
    } catch (e) {
      return null;
    }
  }

  readLHMSharedMemory() {
    if (!this.initialized) return null;

    try {
      const openedMap = this.copySharedMemoryFlexible(
        this.LHM_MAP_ALIASES || [this.LHM_MAP],
        [4 * 1024 * 1024, 2 * 1024 * 1024, 1024 * 1024, 512 * 1024, 256 * 1024, 128 * 1024, 64 * 1024, 32 * 1024, 16 * 1024, 8 * 1024, 4096]
      );
      if (!openedMap || !openedMap.buffer) return null;

      const xml = this.readXmlLikeText(openedMap.buffer, openedMap.buffer.length);
      if (!xml || xml.length < 20 || !xml.includes('<hardware>')) return null;

      const result = this.createProviderResult('lhm');
      const hardwareBlocks = [...xml.matchAll(/<hardware>([\s\S]*?)<\/hardware>/gi)];

      for (const hardwareMatch of hardwareBlocks) {
        const hardwareXml = hardwareMatch[1];
        const ownerId = (hardwareXml.match(/<id>([\s\S]*?)<\/id>/i) || [])[1] || '';
        const ownerName = (hardwareXml.match(/<name>([\s\S]*?)<\/name>/i) || [])[1] || '';
        const owner = `${ownerName}`.trim() || ownerId || 'LHM';

        const sensorBlocks = [...hardwareXml.matchAll(/<sensor>([\s\S]*?)<\/sensor>/gi)];
        for (const sensorMatch of sensorBlocks) {
          const sensorXml = sensorMatch[1];
          const id = ((sensorXml.match(/<id>([\s\S]*?)<\/id>/i) || [])[1] || '').trim();
          const name = ((sensorXml.match(/<name>([\s\S]*?)<\/name>/i) || [])[1] || '').trim();
          const type = ((sensorXml.match(/<type>([\s\S]*?)<\/type>/i) || [])[1] || '').trim();
          const valueRaw = ((sensorXml.match(/<value>([\s\S]*?)<\/value>/i) || [])[1] || '').trim().replace(',', '.');

          if (!id || !valueRaw) continue;
          const value = parseFloat(valueRaw);
          if (!Number.isFinite(value)) continue;

          const inferredUnits = (() => {
            const t = type.toLowerCase();
            if (t.includes('temperature')) return 'C';
            if (t.includes('load')) return '%';
            if (t.includes('clock')) return 'MHz';
            if (t.includes('fan')) return 'RPM';
            if (t.includes('power')) return 'W';
            if (t.includes('data')) return 'GB';
            return '';
          })();

          const fullName = `${owner} ${name}`.trim();
          const group = this.classifySensorGroup(fullName, inferredUnits, -1);
          const sensorId = `lhm_${ownerId || 'owner'}_${id}`.replace(/[^a-zA-Z0-9_\-]/g, '_');
          const normalizedValue = (group === 'ram' || (group === 'gpu' && fullName.toLowerCase().includes('memory')))
            ? this.normalizeMemoryValue(value, inferredUnits)
            : value;

          this.addProviderSensor(result, {
            id: sensorId,
            name: fullName,
            value: normalizedValue,
            units: inferredUnits,
            group,
            provider: 'lhm'
          });

          this.mapCommonMetrics(result, fullName, inferredUnits, normalizedValue);
        }
      }

      if (!result.availableSensors.length) return null;
      return result;
    } catch (e) {
      return null;
    }
  }

  parseSensorTextFromOSD(text) {
    const result = {
      cpuTemp: null,
      cpuLoad: null,
      cpuPower: null,
      cpuFreq: null,
      gpuTemp: null,
      gpuLoad: null,
      gpuMemory: null,
      gpuPower: null,
      gpuFreq: null,
      ramUsage: null,
      psuTemp: null,
      fanSpeeds: [],
      fps: 0,
      frameTime: 0
    };

    if (text.includes('<L')) {
      const lineEntries = this.extractOSDLineEntries(text);

      const fpsLine = lineEntries.find((entry) => /\bfps\b/i.test(entry.text));
      if (fpsLine) {
        const fpsVal = this.parseNumberFromLine(fpsLine.text);
        if (fpsVal !== null) result.fps = fpsVal;
      }

      const cpuLabel = lineEntries.find((entry) => /^cpu\s*:?$/i.test(entry.text) || /\bcpu\b/i.test(entry.text));
      const gpuLabel = lineEntries.find((entry) => /^gpu\s*:?$/i.test(entry.text) || /\bgpu\b/i.test(entry.text));

      if (cpuLabel && gpuLabel) {
        const firstValueLine = Math.max(cpuLabel.lineNo, gpuLabel.lineNo) + 1;
        const valueEntries = lineEntries
          .filter((entry) => entry.lineNo >= firstValueLine)
          .sort((a, b) => a.lineNo - b.lineNo);

        for (let i = 0; i + 1 < valueEntries.length; i += 2) {
          const cpuText = valueEntries[i].text;
          const gpuText = valueEntries[i + 1].text;
          const cpuVal = this.parseNumberFromLine(cpuText);
          const gpuVal = this.parseNumberFromLine(gpuText);

          const cpuLower = cpuText.toLowerCase();
          const gpuLower = gpuText.toLowerCase();

          if (cpuVal !== null && gpuVal !== null) {
            if (cpuLower.includes('%') && gpuLower.includes('%')) {
              if (result.cpuLoad === null) result.cpuLoad = cpuVal;
              if (result.gpuLoad === null) result.gpuLoad = gpuVal;
            } else if (cpuLower.includes('c') && gpuLower.includes('c')) {
              if (result.cpuTemp === null) result.cpuTemp = cpuVal;
              if (result.gpuTemp === null) result.gpuTemp = gpuVal;
            } else if (cpuLower.includes('w') && gpuLower.includes('w')) {
              if (result.cpuPower === null) result.cpuPower = cpuVal;
              if (result.gpuPower === null) result.gpuPower = gpuVal;
            } else if (cpuLower.includes('mhz') && gpuLower.includes('mhz')) {
              if (result.cpuFreq === null) result.cpuFreq = cpuVal;
              if (result.gpuFreq === null) result.gpuFreq = gpuVal;
            } else if (cpuLower.includes('gb') && gpuLower.includes('gb')) {
              if (result.ramUsage === null) result.ramUsage = cpuVal;
              if (result.gpuMemory === null) result.gpuMemory = gpuVal;
            } else if (cpuLower.includes('rpm') || gpuLower.includes('rpm')) {
              if (cpuLower.includes('rpm')) {
                result.fanSpeeds.push({ name: `Fan ${result.fanSpeeds.length + 1}`, value: cpuVal, units: 'RPM' });
              }
              if (gpuLower.includes('rpm')) {
                result.fanSpeeds.push({ name: `Fan ${result.fanSpeeds.length + 1}`, value: gpuVal, units: 'RPM' });
              }
            } else if (cpuLower.includes('%') && gpuLower.includes('%') && result.cpuLoad !== null && result.gpuLoad !== null) {
              if (result.fanSpeeds.length === 0) {
                result.fanSpeeds.push({ name: 'Fan 1', value: cpuVal, units: '%' });
                result.fanSpeeds.push({ name: 'Fan 2', value: gpuVal, units: '%' });
              }
            }
          }
        }
      }
    }

    const cleaned = text
      .replace(/<[^>]*>/g, ' ')
      .replace(/[|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const grab = (regex) => {
      const m = cleaned.match(regex);
      if (!m) return null;
      const v = parseFloat(m[1]);
      return Number.isFinite(v) ? v : null;
    };

    const fpsFromText = grab(/\bfps\s*:?\s*(-?\d+(?:\.\d+)?)/i);
    if (result.fps <= 0 && fpsFromText !== null) result.fps = fpsFromText;

    const frameTimeFromText = grab(/\b(?:frame\s*time|frametime)\s*:?\s*(-?\d+(?:\.\d+)?)/i);
    if (result.frameTime <= 0 && frameTimeFromText !== null) result.frameTime = frameTimeFromText;

    const cpuTempFromText = grab(/\bcpu\s*(?:temperature|temp)\s*:?\s*(-?\d+(?:\.\d+)?)/i);
    if (result.cpuTemp === null && cpuTempFromText !== null) result.cpuTemp = cpuTempFromText;

    const cpuLoadFromText = grab(/\bcpu\s*(?:usage|load)?\s*:?\s*(-?\d+(?:\.\d+)?)\s*%/i);
    if (result.cpuLoad === null && cpuLoadFromText !== null) result.cpuLoad = cpuLoadFromText;

    const cpuPowerFromText = grab(/\bcpu\s*power\s*:?\s*(-?\d+(?:\.\d+)?)/i);
    if (result.cpuPower === null && cpuPowerFromText !== null) result.cpuPower = cpuPowerFromText;

    const gpuTempFromText = grab(/\bgpu\s*(?:temperature|temp)\s*:?\s*(-?\d+(?:\.\d+)?)/i);
    if (result.gpuTemp === null && gpuTempFromText !== null) result.gpuTemp = gpuTempFromText;

    const gpuLoadFromText = grab(/\bgpu\s*(?:usage|load)?\s*:?\s*(-?\d+(?:\.\d+)?)\s*%/i);
    if (result.gpuLoad === null && gpuLoadFromText !== null) result.gpuLoad = gpuLoadFromText;

    const gpuMemoryFromText = grab(/\b(?:gpu\s*)?(?:memory|vram)(?:\s*usage)?\s*:?\s*(-?\d+(?:\.\d+)?)/i);
    if (result.gpuMemory === null && gpuMemoryFromText !== null) result.gpuMemory = gpuMemoryFromText;

    const gpuPowerFromText = grab(/\bgpu\s*power\s*:?\s*(-?\d+(?:\.\d+)?)/i);
    if (result.gpuPower === null && gpuPowerFromText !== null) result.gpuPower = gpuPowerFromText;

    const gpuFreqFromText = grab(/\bgpu\s*(?:clock|freq(?:uency)?)\s*:?\s*(-?\d+(?:\.\d+)?)/i);
    if (result.gpuFreq === null && gpuFreqFromText !== null) result.gpuFreq = gpuFreqFromText;

    const cpuFreqFromText = grab(/\bcpu\s*(?:clock|freq(?:uency)?)\s*:?\s*(-?\d+(?:\.\d+)?)/i);
    if (result.cpuFreq === null && cpuFreqFromText !== null) result.cpuFreq = cpuFreqFromText;

    const ramUsageFromText = grab(/\bram(?:\s*usage)?\s*:?\s*(-?\d+(?:\.\d+)?)/i);
    if (result.ramUsage === null && ramUsageFromText !== null) result.ramUsage = ramUsageFromText;

    const psuTempFromText = grab(/\bpsu\s*(?:temperature|temp)\s*:?\s*(-?\d+(?:\.\d+)?)/i);
    if (result.psuTemp === null && psuTempFromText !== null) result.psuTemp = psuTempFromText;

    const fanRegex = /\bfan\s*(\d+)?\s*:?\s*(-?\d+(?:\.\d+)?)(?:\s*(rpm|%))?/ig;
    let fanMatch = fanRegex.exec(cleaned);
    while (fanMatch) {
      const idx = fanMatch[1];
      const val = parseFloat(fanMatch[2]);
      const units = fanMatch[3] || '';
      if (Number.isFinite(val)) {
        result.fanSpeeds.push({
          name: idx ? `Fan ${idx}` : `Fan ${result.fanSpeeds.length + 1}`,
          value: val,
          units: units.toUpperCase()
        });
      }
      fanMatch = fanRegex.exec(cleaned);
    }

    const lines = text
      .split(/[\r\n]+/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      const lower = line.toLowerCase();
      const value = this.parseNumberFromLine(line);
      if (value === null) continue;

      if (result.cpuTemp === null && lower.includes('cpu') && (lower.includes('temp') || lower.includes('tctl') || lower.includes('tdie'))) {
        result.cpuTemp = value;
      } else if (result.cpuLoad === null && lower.includes('cpu') && (lower.includes('usage') || lower.includes('load'))) {
        result.cpuLoad = value;
      } else if (result.cpuPower === null && lower.includes('cpu') && lower.includes('power')) {
        result.cpuPower = value;
      } else if (result.gpuTemp === null && lower.includes('gpu') && lower.includes('temp')) {
        result.gpuTemp = value;
      } else if (result.gpuLoad === null && lower.includes('gpu') && (lower.includes('usage') || lower.includes('load'))) {
        result.gpuLoad = value;
      } else if (result.gpuMemory === null && lower.includes('gpu') && (lower.includes('memory') || lower.includes('vram'))) {
        result.gpuMemory = value;
      } else if (result.gpuPower === null && lower.includes('gpu') && lower.includes('power')) {
        result.gpuPower = value;
      } else if (result.ramUsage === null && (lower.includes('ram') || lower.includes('memory usage')) && !lower.includes('gpu')) {
        result.ramUsage = value;
      } else if (result.psuTemp === null && lower.includes('psu') && lower.includes('temp')) {
        result.psuTemp = value;
      } else if (lower.includes('fan')) {
        const fanIndexMatch = lower.match(/fan\s*(\d+)/);
        result.fanSpeeds.push({
          name: fanIndexMatch ? `Fan ${fanIndexMatch[1]}` : `Fan ${result.fanSpeeds.length + 1}`,
          value,
          units: lower.includes('rpm') ? 'RPM' : ''
        });
      } else if (result.fps <= 0 && (lower.includes('fps') || lower.includes('framerate'))) {
        result.fps = value;
      } else if (result.frameTime <= 0 && (lower.includes('frametime') || lower.includes('frame time') || lower.includes('ms'))) {
        result.frameTime = value;
      }
    }

    return result;
  }

  readRTSSOSDData() {
    if (!this.initialized) return null;

    try {
      const mappingName = this.copySharedMemory('RTSSSharedMemoryV2', 4096) ? 'RTSSSharedMemoryV2' : 'RTSSSharedMemory';
      const header = this.readRTSSHeader(mappingName);
      if (!header) return null;

      const { dwOSDEntrySize, dwOSDArrOffset, dwOSDArrSize } = header;
      if (!dwOSDEntrySize || !dwOSDArrOffset || !dwOSDArrSize) return null;

      const requiredSize = dwOSDArrOffset + (dwOSDArrSize * dwOSDEntrySize);
      const safeSize = Math.min(Math.max(requiredSize, 4096), 16 * 1024 * 1024);
      const buf = this.copySharedMemory(mappingName, safeSize);
      if (!buf) return null;

      const texts = [];
      for (let i = 0; i < dwOSDArrSize; i++) {
        const base = dwOSDArrOffset + (i * dwOSDEntrySize);
        if (base + 512 > buf.length) break;

        const owner = this.readCString(buf, base + 256, 256);
        const osd = this.readCString(buf, base, 256);
        const osdEx = (base + 512 + 4096 <= buf.length) ? this.readCString(buf, base + 512, 4096) : '';
        const osdEx2 = (base + 266752 + 32768 <= buf.length) ? this.readCString(buf, base + 266752, 32768) : '';

        const text = osdEx2 || osdEx || osd;
        if (text && text.length > 0) {
          texts.push({ owner, text });
        }
      }

      if (!texts.length) return null;

      const preferred = texts.find((entry) => entry.owner && entry.owner.toLowerCase().includes('overlayeditor')) || texts[0];
      const parsed = this.parseSensorTextFromOSD(preferred.text);
      const osdLineEntries = this.extractOSDLineEntries(preferred.text);
      const osdCatalog = this.buildCatalogFromOSDLines(osdLineEntries);

      return {
        ...parsed,
        osdLineEntries,
        osdCatalog,
        osdOwner: preferred.owner || null,
        source: 'rtss-osd'
      };
    } catch (e) {
      return null;
    }
  }

  readMAHMSharedMemory() {
    if (!this.initialized) return null;

    try {
      const headerBuf = this.copySharedMemory('MAHMSharedMemory', 4096);
      if (!headerBuf) {
        return null;
      }

      const headerDv = new DataView(headerBuf.buffer, headerBuf.byteOffset, headerBuf.length);
      const signature = headerDv.getUint32(0, true);
      if (signature !== this.MAHM_SIG) {
        return null;
      }

      const headerSize = headerDv.getUint32(8, true);
      const numEntries = headerDv.getUint32(12, true);
      const entrySize = headerDv.getUint32(16, true);
      if (!headerSize || !numEntries || !entrySize) {
        return null;
      }

      const requiredSize = Math.min(Math.max(headerSize + (numEntries * entrySize), 4096), 4 * 1024 * 1024);
      const tempBuf = this.copySharedMemory('MAHMSharedMemory', requiredSize);
      if (!tempBuf) {
        return null;
      }

      const dv = new DataView(tempBuf.buffer, tempBuf.byteOffset, tempBuf.length);
      const signature2 = dv.getUint32(0, true);
      if (signature2 !== this.MAHM_SIG) {
        return null;
      }

      if (!headerSize || !numEntries || !entrySize || headerSize >= tempBuf.length) {
        return null;
      }

      const result = {
        cpuTemp: null,
        cpuLoad: null,
        cpuPower: null,
        cpuFreq: null,
        gpuTemp: null,
        gpuLoad: null,
        gpuMemory: null,
        gpuPower: null,
        gpuFreq: null,
        ramUsage: null,
        psuTemp: null,
        fanSpeeds: [],
        fps: 0,
        frameTime: 0,
        availableSensors: [],
        groupedSensors: this.createGroupedSensorBuckets(),
        timestamp: Date.now()
      };

      const maxPath = 260;
      const srcNameOffset = 0;
      const srcUnitsOffset = maxPath;
      const localizedSrcNameOffset = maxPath * 2;
      const dataOffset = maxPath * 5;
      const gpuIndexOffset = dataOffset + 16;
      const srcIdOffset = dataOffset + 20;

      for (let i = 0; i < numEntries; i++) {
        const base = headerSize + i * entrySize;
        if (base + srcIdOffset + 4 > tempBuf.length) break;

        const srcName = this.readCString(tempBuf, base + srcNameOffset, maxPath);
        const srcUnits = this.readCString(tempBuf, base + srcUnitsOffset, maxPath);
        const localizedSrcName = this.readCString(tempBuf, base + localizedSrcNameOffset, maxPath);
        const sourceName = localizedSrcName || srcName;

        const value = dv.getFloat32(base + dataOffset, true);
        if (!Number.isFinite(value) || value > 3.4e38) continue;

        const srcId = dv.getUint32(base + srcIdOffset, true);
        const gpuIndex = dv.getUint32(base + gpuIndexOffset, true);
        const lowerName = sourceName.toLowerCase();
        const lowerUnits = srcUnits.toLowerCase();

        const sensorId = `${srcId.toString(16)}_${gpuIndex}_${sourceName.replace(/\s+/g, '_').toLowerCase()}`;
        const sensorGroup = this.classifySensorGroup(sourceName, srcUnits, srcId);
        const sensorEntry = {
          id: sensorId,
          name: sourceName,
          units: srcUnits,
          value,
          group: sensorGroup,
          srcId,
          gpuIndex
        };

        result.availableSensors.push(sensorEntry);
        if (!result.groupedSensors[sensorGroup]) {
          result.groupedSensors[sensorGroup] = [];
        }
        result.groupedSensors[sensorGroup].push(sensorEntry);

        switch (srcId) {
          case this.MAHM_SOURCE_IDS.CPU_TEMPERATURE:
            result.cpuTemp = value;
            break;
          case this.MAHM_SOURCE_IDS.CPU_USAGE:
            result.cpuLoad = value;
            break;
          case this.MAHM_SOURCE_IDS.CPU_POWER:
            result.cpuPower = value;
            break;
          case this.MAHM_SOURCE_IDS.CPU_CLOCK:
            result.cpuFreq = value;
            break;
          case this.MAHM_SOURCE_IDS.GPU_TEMPERATURE:
            if (result.gpuTemp === null) result.gpuTemp = value;
            break;
          case this.MAHM_SOURCE_IDS.GPU_USAGE:
            result.gpuLoad = value;
            break;
          case this.MAHM_SOURCE_IDS.CORE_CLOCK:
            if (result.gpuFreq === null) result.gpuFreq = value;
            break;
          case this.MAHM_SOURCE_IDS.MEMORY_USAGE:
            result.gpuMemory = value;
            break;
          case this.MAHM_SOURCE_IDS.GPU_ABS_POWER:
          case this.MAHM_SOURCE_IDS.GPU_REL_POWER:
            result.gpuPower = value;
            break;
          case this.MAHM_SOURCE_IDS.RAM_USAGE:
            result.ramUsage = value;
            break;
          case this.MAHM_SOURCE_IDS.FAN_SPEED:
          case this.MAHM_SOURCE_IDS.FAN_TACHOMETER:
          case this.MAHM_SOURCE_IDS.FAN_SPEED2:
          case this.MAHM_SOURCE_IDS.FAN_TACHOMETER2:
          case this.MAHM_SOURCE_IDS.FAN_SPEED3:
          case this.MAHM_SOURCE_IDS.FAN_TACHOMETER3:
            result.fanSpeeds.push({
              name: sourceName || `Fan ${result.fanSpeeds.length + 1}`,
              value,
              units: srcUnits
            });
            break;
          case this.MAHM_SOURCE_IDS.FRAMERATE:
            result.fps = value;
            break;
          case this.MAHM_SOURCE_IDS.FRAMETIME:
            result.frameTime = value;
            break;
          case this.MAHM_SOURCE_IDS.PLUGIN_PSU:
            if (lowerName.includes('temp') || lowerUnits.includes('c')) {
              result.psuTemp = value;
            }
            break;
          default:
            break;
        }

        if ((result.psuTemp === null) && lowerName.includes('psu') && lowerName.includes('temp')) {
          result.psuTemp = value;
        }
      }

      return result;
    } catch (e) {
      return null;
    }
  }

  /**
   * Read RTSS shared memory and extract sensor data
   */
  readRTSSSharedMemory() {
    if (!this.initialized) return null;

    try {
      let tempBuf = this.copySharedMemory('RTSSSharedMemoryV2', 4096);
      if (!tempBuf) {
        tempBuf = this.copySharedMemory('RTSSSharedMemory', 4096);
      }
      if (!tempBuf) {
        return null;
      }

      const dv = new DataView(tempBuf.buffer, tempBuf.byteOffset, 4096);
      const version = dv.getUint32(4, true);
      const time0 = dv.getUint32(8, true);
      const time1 = dv.getUint32(12, true);
      const frames = dv.getUint32(16, true);

      const data = {
        fps: 0,
        frameTime: 0,
        timestamp: Date.now(),
        rtssVersion: version
      };

      if (frames > 0 && time1 > time0) {
        const timeDiffMs = (time1 - time0) / 1000;
        if (timeDiffMs > 0) {
          data.fps = Math.round((frames * 1000) / timeDiffMs);
          data.frameTime = timeDiffMs / frames;
        }
      }

      return data;
    } catch (e) {
      return null;
    }
  }

  /**
   * Read RTSS shared memory for FPS data (main entry point)
   */
  readRTSSExtendedData() {
    if (!this.initialized) return null;

    try {
      const options = arguments[0] || {};
      const providers = options.providers || {};
      const useRTSS = providers.rtss !== false;
      const useAIDA64 = providers.aida64 !== false;
      const useHWiNFO = providers.hwinfo !== false;

      const rtssData = useRTSS ? this.readRTSSSharedMemory() : null;
      const mahmData = useRTSS ? this.readMAHMSharedMemory() : null;
      const aidaData = useAIDA64 ? this.readAIDA64SharedMemory() : null;
      const hwinfoData = useHWiNFO ? this.readHWiNFOSharedMemory() : null;
      const lhmData = useHWiNFO ? this.readLHMSharedMemory() : null;

      if (!rtssData && !mahmData && !aidaData && !hwinfoData && !lhmData) return null;

      const firstAvailable = (...vals) => {
        for (const v of vals) {
          if (v !== null && v !== undefined && !(typeof v === 'number' && Number.isNaN(v))) return v;
        }
        return null;
      };

      const selectedFanSpeeds = (mahmData && mahmData.fanSpeeds && mahmData.fanSpeeds.length > 0)
        ? mahmData.fanSpeeds
        : ((hwinfoData && hwinfoData.fanSpeeds && hwinfoData.fanSpeeds.length > 0)
          ? hwinfoData.fanSpeeds
          : ((lhmData && lhmData.fanSpeeds && lhmData.fanSpeeds.length > 0)
            ? lhmData.fanSpeeds
            : []));

      const fallbackCatalog = this.buildGroupedFromParsedMetrics({
        cpuTemp: firstAvailable(mahmData ? mahmData.cpuTemp : null, hwinfoData ? hwinfoData.cpuTemp : null, lhmData ? lhmData.cpuTemp : null, aidaData ? aidaData.cpuTemp : null),
        cpuLoad: firstAvailable(mahmData ? mahmData.cpuLoad : null, aidaData ? aidaData.cpuLoad : null, hwinfoData ? hwinfoData.cpuLoad : null, lhmData ? lhmData.cpuLoad : null),
        cpuPower: firstAvailable(mahmData ? mahmData.cpuPower : null, aidaData ? aidaData.cpuPower : null, hwinfoData ? hwinfoData.cpuPower : null, lhmData ? lhmData.cpuPower : null),
        cpuFreq: firstAvailable(mahmData ? mahmData.cpuFreq : null, aidaData ? aidaData.cpuFreq : null, hwinfoData ? hwinfoData.cpuFreq : null, lhmData ? lhmData.cpuFreq : null),
        gpuTemp: firstAvailable(mahmData ? mahmData.gpuTemp : null, aidaData ? aidaData.gpuTemp : null, hwinfoData ? hwinfoData.gpuTemp : null, lhmData ? lhmData.gpuTemp : null),
        gpuLoad: firstAvailable(mahmData ? mahmData.gpuLoad : null, aidaData ? aidaData.gpuLoad : null, hwinfoData ? hwinfoData.gpuLoad : null, lhmData ? lhmData.gpuLoad : null),
        gpuMemory: firstAvailable(mahmData ? mahmData.gpuMemory : null, aidaData ? aidaData.gpuMemory : null, hwinfoData ? hwinfoData.gpuMemory : null, lhmData ? lhmData.gpuMemory : null),
        gpuPower: firstAvailable(mahmData ? mahmData.gpuPower : null, aidaData ? aidaData.gpuPower : null, hwinfoData ? hwinfoData.gpuPower : null, lhmData ? lhmData.gpuPower : null),
        gpuFreq: firstAvailable(mahmData ? mahmData.gpuFreq : null, aidaData ? aidaData.gpuFreq : null, hwinfoData ? hwinfoData.gpuFreq : null, lhmData ? lhmData.gpuFreq : null),
        ramUsage: firstAvailable(mahmData ? mahmData.ramUsage : null, aidaData ? aidaData.ramUsage : null, hwinfoData ? hwinfoData.ramUsage : null, lhmData ? lhmData.ramUsage : null),
        psuTemp: firstAvailable(mahmData ? mahmData.psuTemp : null, aidaData ? aidaData.psuTemp : null, hwinfoData ? hwinfoData.psuTemp : null, lhmData ? lhmData.psuTemp : null),
        fanSpeeds: selectedFanSpeeds
      });

      const providerCatalog = [
        mahmData && mahmData.groupedSensors ? mahmData.groupedSensors : this.createGroupedSensorBuckets(),
        aidaData && aidaData.groupedSensors ? aidaData.groupedSensors : this.createGroupedSensorBuckets(),
        hwinfoData && hwinfoData.groupedSensors ? hwinfoData.groupedSensors : this.createGroupedSensorBuckets(),
        lhmData && lhmData.groupedSensors ? lhmData.groupedSensors : this.createGroupedSensorBuckets(),
        fallbackCatalog.groupedSensors
      ].reduce((acc, catalog) => this.mergeCatalogs(acc, catalog), this.createGroupedSensorBuckets());

        const mergedFallbackCatalog = providerCatalog;
        const mergedFallbackAvailable = this.flattenGroupedCatalog(mergedFallbackCatalog);
        const mergedFps = firstAvailable(mahmData && mahmData.fps > 0 ? mahmData.fps : null, rtssData ? rtssData.fps : 0) || 0;
        const rawMergedFrameTime = firstAvailable(mahmData && mahmData.frameTime > 0 ? mahmData.frameTime : null, rtssData ? rtssData.frameTime : 0) || 0;
        const mergedFrameTime = (rawMergedFrameTime > 0)
          ? rawMergedFrameTime
          : (mergedFps > 0 ? (1000 / mergedFps) : 0);

      return {
          fps: mergedFps,
          frameTime: mergedFrameTime,
        cpuTemp: firstAvailable(mahmData ? mahmData.cpuTemp : null, aidaData ? aidaData.cpuTemp : null, hwinfoData ? hwinfoData.cpuTemp : null, lhmData ? lhmData.cpuTemp : null),
        cpuLoad: firstAvailable(mahmData ? mahmData.cpuLoad : null, aidaData ? aidaData.cpuLoad : null, hwinfoData ? hwinfoData.cpuLoad : null, lhmData ? lhmData.cpuLoad : null),
        cpuPower: firstAvailable(mahmData ? mahmData.cpuPower : null, aidaData ? aidaData.cpuPower : null, hwinfoData ? hwinfoData.cpuPower : null, lhmData ? lhmData.cpuPower : null),
        cpuFreq: firstAvailable(mahmData ? mahmData.cpuFreq : null, aidaData ? aidaData.cpuFreq : null, hwinfoData ? hwinfoData.cpuFreq : null, lhmData ? lhmData.cpuFreq : null),
        gpuTemp: firstAvailable(mahmData ? mahmData.gpuTemp : null, aidaData ? aidaData.gpuTemp : null, hwinfoData ? hwinfoData.gpuTemp : null, lhmData ? lhmData.gpuTemp : null),
        gpuLoad: firstAvailable(mahmData ? mahmData.gpuLoad : null, aidaData ? aidaData.gpuLoad : null, hwinfoData ? hwinfoData.gpuLoad : null, lhmData ? lhmData.gpuLoad : null),
        gpuMemory: firstAvailable(mahmData ? mahmData.gpuMemory : null, aidaData ? aidaData.gpuMemory : null, hwinfoData ? hwinfoData.gpuMemory : null, lhmData ? lhmData.gpuMemory : null),
        gpuPower: firstAvailable(mahmData ? mahmData.gpuPower : null, aidaData ? aidaData.gpuPower : null, hwinfoData ? hwinfoData.gpuPower : null, lhmData ? lhmData.gpuPower : null),
        gpuFreq: firstAvailable(mahmData ? mahmData.gpuFreq : null, aidaData ? aidaData.gpuFreq : null, hwinfoData ? hwinfoData.gpuFreq : null, lhmData ? lhmData.gpuFreq : null),
        ramUsage: firstAvailable(mahmData ? mahmData.ramUsage : null, aidaData ? aidaData.ramUsage : null, hwinfoData ? hwinfoData.ramUsage : null, lhmData ? lhmData.ramUsage : null),
        psuTemp: firstAvailable(mahmData ? mahmData.psuTemp : null, aidaData ? aidaData.psuTemp : null, hwinfoData ? hwinfoData.psuTemp : null, lhmData ? lhmData.psuTemp : null),
        fanSpeeds: selectedFanSpeeds,
        availableSensors: mergedFallbackAvailable,
        groupedSensors: mergedFallbackCatalog,
        timestamp: Date.now(),
        source: [
          rtssData ? 'rtss' : null,
          mahmData ? 'mahm' : null,
          aidaData ? 'aida' : null,
          hwinfoData ? 'hwinfo' : null,
          lhmData ? 'lhm' : null
        ].filter(Boolean).join('+')
      };
    } catch (e) {
      return null;
    }
  }
}

module.exports = RTSSReader;
