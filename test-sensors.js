#!/usr/bin/env node

const SensorReader = require('./sensorReader');
const RTSSReader = require('./rtssReader');

async function testSensors() {
  const reader = new SensorReader();
  const rtssReader = new RTSSReader();
  
  console.log('Testing sensor detection...\n');
  
  try {
    console.log('0. Provider map availability...');
    const providerMaps = [
      ['RTSS v2', 'RTSSSharedMemoryV2', 4096],
      ['RTSS v1', 'RTSSSharedMemory', 4096],
      ['MAHM', 'MAHMSharedMemory', 65536],
      ['HWiNFO', 'Global\\HWiNFO_SENS_SM2', 4096],
      ['HWiNFO (alt)', 'HWiNFO_SENS_SM2', 4096],
      ['LHM', 'LHMDPSharedMemory', 4096],
      ['LHM (Global)', 'Global\\LHMDPSharedMemory', 4096],
      ['AIDA', 'AIDA64_SensorValues', 4096],
      ['AIDA (Global)', 'Global\\AIDA64_SensorValues', 4096],
      ['PresentMon', 'PMDPSharedMemory', 4096]
    ];

    providerMaps.forEach(([label, mapName, size]) => {
      const opened = !!rtssReader.copySharedMemory(mapName, size);
      console.log(`- ${label}: ${opened ? 'OPEN' : 'MISS'} (${mapName})`);
    });
    const aidaProbe =
      rtssReader.copySharedMemory('AIDA64_SensorValues', 4096) ||
      rtssReader.copySharedMemory('Global\\AIDA64_SensorValues', 4096) ||
      rtssReader.copySharedMemory('AIDA64_SensorValues', 64 * 1024) ||
      rtssReader.copySharedMemory('Global\\AIDA64_SensorValues', 64 * 1024);
    if (aidaProbe) {
      const xmlText = rtssReader.readXmlLikeText(aidaProbe, aidaProbe.length);
      console.log(`AIDA payload preview length: ${xmlText ? xmlText.length : 0}`);
      console.log('AIDA payload head:', (xmlText || '').slice(0, 300).replace(/\s+/g, ' '));
    }
    console.log('');

    console.log('1. Testing CPU data...');
    const cpu = await reader.getCPUMetrics();
    console.log('CPU:', cpu);
    console.log('');
    
    console.log('2. Testing GPU data...');
    const gpu = await reader.getGPUMetrics();
    console.log('GPU:', gpu);
    console.log('');
    
    console.log('3. Testing Fan sensors...');
    const fans = await reader.getFanSensors();
    console.log('Fans:', fans);
    console.log('');
    
    console.log('4. Testing PSU data...');
    const psu = await reader.getPSUData();
    console.log('PSU:', psu);
    console.log('');
    
    console.log('5. Testing Full Enhanced Data...');
    console.log('Trying various detection modes:');
    for (const mode of ['wmi','aida','msi']) {
      try {
        const enhanced = await reader.getEnhancedData(mode);
        console.log(`Mode=${mode}`, enhanced);

        if (mode === 'msi' && enhanced && enhanced.external) {
          const grouped = enhanced.external.groupedSensors || {};
          const groupedCounts = Object.fromEntries(
            Object.entries(grouped).map(([group, sensors]) => [group, (sensors || []).length])
          );

          console.log('\nMSI grouped sensor counts:', groupedCounts);
          console.log('MSI available sensors (detailed):');
          const available = enhanced.external.availableSensors || [];
          available.forEach((sensor) => {
            console.log(`- [${sensor.group}] ${sensor.name}: ${sensor.value} ${sensor.units || ''} (${sensor.id})`);
          });
        }
      } catch(e) {
        console.log(`Mode=${mode} error`, e.message);
      }
    }

    console.log('\n6. Raw RTSS OSD line detection...');
    const rtssRaw = rtssReader.readRTSSOSDData();
    if (rtssRaw && rtssRaw.osdLineEntries) {
      console.log(`OSD Owner: ${rtssRaw.osdOwner || 'Unknown'}`);
      console.log('OSD Lines:');
      rtssRaw.osdLineEntries.forEach((entry) => {
        console.log(`  L${entry.lineNo}: ${entry.text}`);
      });
    } else {
      console.log('No raw OSD lines detected');
    }
    
  } catch (error) {
    console.error('Error during testing:', error);
  }
}

testSensors();
