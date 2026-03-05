const { execSync } = require('child_process');
const si = require('systeminformation');
const fs = require('fs');
const path = require('path');
const os = require('os');
const RTSSReader = require('./rtssReader');

class SensorReader {
  constructor() {
    this.cache = {};
    this.cacheTimeout = 2000;
    this.lastUpdate = 0;
    this.rtssReader = new RTSSReader();
  }

  executePowerShell(psScript) {
    try {
      const tempDir = os.tmpdir();
      const scriptPath = path.join(tempDir, `ps_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.ps1`);
      fs.writeFileSync(scriptPath, psScript, 'utf8');
      try {
        const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, {
          encoding: 'utf8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe']
        });
        return result.trim();
      } finally {
        try { if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath); } catch (e) {}
      }
    } catch (e) {
      console.debug(`PowerShell execution failed: ${e.message}`);
      return null;
    }
  }

  async getCPUMetrics() {
    try {
      const [current, speed] = await Promise.all([si.currentLoad(), si.cpuCurrentSpeed()]);
      return {
        load: (current.currentLoad || 0).toFixed(1),
        temp: null,
        speed: (speed.avg || 0).toFixed(2),
        cores: current.cpus ? current.cpus.length : 0
      };
    } catch (e) {
      console.error('CPU metrics error:', e.message);
      return null;
    }
  }

  async getCPUTemperatureWMI() {
    try {
      const script = `$temp = Get-WmiObject -Namespace "root\\wmi" -Class MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | Select-Object -First 1
if ($temp) {
  $celsius = ($temp.CurrentTemperature - 2732) / 10
  Write-Host ([Math]::Round($celsius, 1))
}`;
      const result = this.executePowerShell(script);
      if (result) {
        const temp = parseFloat(result);
        return isNaN(temp) ? 0 : temp;
      }
      return 0;
    } catch (e) {
      console.debug('WMI CPU temperature failed:', e.message);
      return 0;
    }
  }

  async getGPUMetrics() {
    try {
      const graphics = await si.graphics();
      if (graphics && graphics.controllers && graphics.controllers.length > 0) {
        const gpu = graphics.controllers[0];
        return {
          name: gpu.model || 'Unknown GPU',
          vram: gpu.vram || 0,
          load: gpu.utilizationGpu || null,
          temp: gpu.temperatureGpu || null,
          freq: gpu.clockCore || null
        };
      }
      return null;
    } catch (e) {
      console.error('GPU metrics error:', e.message);
      return null;
    }
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

  async getMotherboardSensors() {
    try {
      const script = `$temps = Get-WmiObject -Namespace "root\\wmi" -Class MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue
if ($temps) {
  $temps | Select-Object @{Name='InstanceName'; Expression={$_.InstanceName}}, @{Name='Celsius'; Expression={[Math]::Round(($_.CurrentTemperature - 2732) / 10, 1)}} | ConvertTo-Json
}`;
      const result = this.executePowerShell(script);
      if (result && result.length > 0) {
        try {
          return JSON.parse(result);
        } catch (e) {
          return null;
        }
      }
      return null;
    } catch (e) {
      console.error('Motherboard sensors error:', e.message);
      return null;
    }
  }

  async getSystemInfo() {
    try {
      const osInfo = await si.osInfo();
      return {
        platform: osInfo.platform,
        distro: osInfo.distro,
        release: osInfo.release
      };
    } catch (e) {
      return null;
    }
  }

  async getFanSensors() {
    try {
      if (si.fans) {
        try {
          const f = await si.fans();
          return f || null;
        } catch (e) {}
      }
      const script = `Get-WmiObject Win32_Fan -ErrorAction SilentlyContinue | Select-Object Name, DesiredSpeed, Status | ConvertTo-Json`;
      const out = this.executePowerShell(script);
      if (out) {
        try {
          return JSON.parse(out);
        } catch (e) {
          return null;
        }
      }
      return null;
    } catch (e) {
      console.error('Fan sensors error:', e.message);
      return null;
    }
  }

  async getPSUData() {
    try {
      const script = `Get-WmiObject Win32_PowerSupply -ErrorAction SilentlyContinue | Select-Object Name, Manufacturer, Status | ConvertTo-Json`;
      const out = this.executePowerShell(script);
      if (out) {
        try {
          return JSON.parse(out);
        } catch (e) {
          return null;
        }
      }
      return null;
    } catch (e) {
      console.error('PSU data error:', e.message);
      return null;
    }
  }

  async getAllSensors() {
    const now = Date.now();
    if (now - this.lastUpdate < this.cacheTimeout && Object.keys(this.cache).length > 0) {
      return this.cache;
    }

    const sensors = await Promise.all([
      this.getCPUMetrics(),
      this.getGPUMetrics(),
      this.getFanSensors(),
      this.getPSUData(),
      this.getMotherboardSensors(),
      this.getSystemInfo()
    ]);

    const result = {
      cpu: sensors[0],
      gpu: sensors[1],
      fans: sensors[2],
      psu: sensors[3],
      motherboard: sensors[4],
      system: sensors[5]
    };

    this.cache = result;
    this.lastUpdate = now;
    return result;
  }

  async getEnhancedData(mode = 'wmi', opts = {}) {
    try {
      if (mode === 'msi') {
        const external = await this.getMSIAfterburnerData({ providers: opts.providers || {} });
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
      }

      const allSensors = await this.getAllSensors();
      const memData = await si.mem();

      let external = null;
      let mergedCpu = allSensors.cpu;
      let mergedGpu = allSensors.gpu;
      let mergedFans = allSensors.fans;
      let mergedPsu = allSensors.psu;

      return {
        cpu: mergedCpu,
        gpu: mergedGpu,
        fans: mergedFans,
        psu: mergedPsu,
        motherboard: allSensors.motherboard,
        external: external,
        memory: {
          used: (memData.used / 1024 / 1024 / 1024).toFixed(2),
          total: (memData.total / 1024 / 1024 / 1024).toFixed(2),
          percent: ((memData.used / memData.total) * 100).toFixed(2)
        },
        system: allSensors.system
      };
    } catch (e) {
      console.error('Error getting enhanced data:', e);
      return null;
    }
  }
}

module.exports = SensorReader;
