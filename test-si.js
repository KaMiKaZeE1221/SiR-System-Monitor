const si = require('systeminformation');

async function testSI() {
  console.log('Testing systeminformation capabilities...\n');
  
  try {
    console.log('1. Current Load:');
    const load = await si.currentLoad();
    console.log(load);
    console.log('');
    
    console.log('2. CPU Temperature:');
    const temp = await si.cpuTemperature();
    console.log(temp);
    console.log('');
    
    console.log('3. CPU Current Speed:');
    const speed = await si.cpuCurrentSpeed();
    console.log(speed);
    console.log('');
    
    console.log('4. Memory:');
    const mem = await si.mem();
    console.log(mem);
    console.log('');
    
    console.log('5. Graphics:');
    const graphics = await si.graphics();
    console.log(graphics);
    console.log('');
    
    console.log('6. Fans (if available):');
    try {
      const fans = await si.fans();
      console.log(fans);
    } catch (e) {
      console.log('si.fans() not available:', e.message);
    }
    console.log('');
    
    console.log('7. CPU Info:');
    const cpuInfo = await si.cpu();
    console.log(cpuInfo);
    console.log('');
    
    console.log('8. System Info:');
    const osInfo = await si.osInfo();
    console.log(osInfo);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testSI();
