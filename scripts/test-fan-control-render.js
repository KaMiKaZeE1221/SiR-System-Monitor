'use strict';

const assert = require('assert');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

ipcMain.handle('overlay:get-displays', () => []);
ipcMain.handle('app:get-runtime-stats', () => ({}));
ipcMain.handle('hardware-access:get-status', () => ({}));
ipcMain.handle('app-behavior:get', () => ({}));
ipcMain.handle('monitoring:set-refresh-interval', () => ({ ok: true }));

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1600,
    height: 1000,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false
    }
  });

  await window.loadFile(path.join(__dirname, '..', 'index.html'));
  await new Promise((resolve) => setTimeout(resolve, 400));
  const result = await window.webContents.executeJavaScript(`(() => {
    latestFanControlCapabilities = [
      { id: 'fan_gpu', name: 'GPU Fan', hardwareName: 'Example Graphics Card', hardwareType: 'GpuAmd', available: true, protectedDevice: false, controlMode: 'Software', currentValue: 44, requestedPercent: 46, relatedFanRpm: 1380, sourceTemperature: 55.2, status: 'Curve · two-sensor average' },
      { id: 'fan_cpu', name: 'CPU Radiator', hardwareName: 'Example Motherboard', hardwareType: 'SuperIO', available: true, protectedDevice: false, controlMode: 'Software', currentValue: 58, requestedPercent: 58, relatedFanRpm: 1125, sourceTemperature: 61.4, status: 'Curve · single sensor' },
      { id: 'fan_case', name: 'Case Intake', hardwareName: 'Example Motherboard', hardwareType: 'SuperIO', available: true, protectedDevice: false, controlMode: 'Default', currentValue: 36, relatedFanRpm: 820, status: 'BIOS / automatic' }
    ];
    latestFanControlTemperatureSensors = [
      { id: 'temp_cpu', name: 'CPU Package', group: 'cpu', value: 61.4 },
      { id: 'temp_gpu', name: 'GPU Core', group: 'gpu', value: 49.0 },
      { id: 'temp_hotspot', name: 'GPU Hot Spot', group: 'gpu', value: 58.8 },
      { id: 'temp_board', name: 'Motherboard', group: 'other', value: 34.5 },
      { id: 'temp_nvme', name: 'NVMe Drive', group: 'drives', value: 42.2 }
    ];
    fanControlSettings = normalizeFanControlSettings({
      enabled: true,
      channels: {
        fan_gpu: { mode: 'global', displayName: 'Graphics exhaust', collapsed: true, offsetPercent: -3 },
        fan_cpu: { mode: 'curve', primarySensorId: 'temp_cpu', hidden: true },
        fan_case: { mode: 'default', offsetPercent: 4 }
      },
      globalCurve: { primarySensorId: 'temp_cpu', secondarySensorId: 'temp_gpu', sensorMode: 'average', curvePoints: [{ temperature: 30, percent: 30 }, { temperature: 50, percent: 45 }, { temperature: 70, percent: 72 }, { temperature: 85, percent: 100 }] }
    });
    fanCurveEditorControlId = GLOBAL_FAN_CURVE_EDITOR_ID;
    applyFanControlView(true, { animate: false });
    renderFanControlSettings(true);
    const view = document.getElementById('fanControlView');
    const initialControls = view.querySelectorAll('.fan-control-tile').length;
    const collapsedContentDisplay = getComputedStyle(view.querySelector('[data-fan-control-card="fan_gpu"] .fan-control-expanded-content')).display;
    const collapsedCardHeight = Math.round(view.querySelector('[data-fan-control-card="fan_gpu"]').getBoundingClientRect().height);
    const expandedCardHeight = Math.round(view.querySelector('[data-fan-control-card="fan_case"]').getBoundingClientRect().height);
    const resetTop = Math.round(view.querySelector('[data-fan-control-card="fan_gpu"] [data-fan-action="reset-name"]').getBoundingClientRect().top);
    const badgeTop = Math.round(view.querySelector('[data-fan-control-card="fan_gpu"] .fan-control-mode-badge').getBoundingClientRect().top);
    const nameInput = view.querySelector('[data-fan-control-card="fan_gpu"] [data-fan-field="displayName"]');
    nameInput.value = 'Rear radiator';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    const renamedSetting = fanControlSettings.channels.fan_gpu.displayName;
    view.querySelector('[data-fan-control-card="fan_case"] [data-fan-action="offset-increase"]')?.click();
    const incrementedOffset = fanControlSettings.channels.fan_case.offsetPercent;
    view.querySelector('[data-fan-action="show-hidden"]')?.click();
    const controlsAfterShow = view.querySelectorAll('.fan-control-tile').length;
    view.querySelector('[data-fan-control-card="fan_case"] [data-fan-action="hide-card"]')?.click();
    const cardHidden = fanControlSettings.channels.fan_case.hidden === true && !view.querySelector('[data-fan-control-card="fan_case"]');
    view.querySelector('[data-fan-action="show-hidden"]')?.click();
    view.querySelector('[data-fan-action="toggle-curve-studio"]')?.click();
    const curveCollapsed = fanControlSettings.curveStudioCollapsed === true && getComputedStyle(view.querySelector('.fan-curve-studio')).display === 'none';
    view.querySelector('[data-fan-action="toggle-curve-studio"]')?.click();
    view.querySelector('[data-fan-action="add-point"]')?.click();
    const nodesAfterAdd = view.querySelectorAll('[data-fan-curve-node]').length;
    view.querySelector('[data-fan-action="remove-point"][data-point-index="2"]')?.click();
    const nodesAfterRemove = view.querySelectorAll('[data-fan-curve-node]').length;
    view.querySelector('[data-fan-action="apply-curve"]')?.click();
    const chart = view.querySelector('[data-fan-curve-chart]');
    const masterWidth = Math.round(document.getElementById('fanControlEnabled').closest('.fan-control-master').getBoundingClientRect().width);
    const restoreWidth = Math.round(document.getElementById('fanControlRestoreAllBtn').getBoundingClientRect().width);
    return {
      viewDisplay: getComputedStyle(view).display,
      dashboardDisplay: getComputedStyle(document.getElementById('statsContainer')).display,
      workspaceHeight: Math.round(view.getBoundingClientRect().height),
      sections: view.querySelectorAll('.fan-workspace-section').length,
      controls: view.querySelectorAll('.fan-control-tile').length,
      initialControls,
      controlsAfterShow,
      temperatures: view.querySelectorAll('.fan-temperature-card').length,
      charts: view.querySelectorAll('[data-fan-curve-chart]').length,
      chartWidth: Math.round(chart?.getBoundingClientRect().width || 0),
      nodesAfterAdd,
      nodesAfterRemove,
      renamedSetting,
      incrementedOffset,
      collapsedContentDisplay,
      collapsedCardHeight,
      expandedCardHeight,
      cardHidden,
      curveCollapsed,
      headerAlignmentDelta: Math.abs(resetTop - badgeTop),
      headerActionWidthDelta: Math.abs(masterWidth - restoreWidth),
      allGlobal: Object.values(fanControlSettings.channels).every((channel) => channel.mode === 'global'),
      globalStudio: view.querySelector('.fan-curve-studio')?.classList.contains('is-global'),
      resetButtons: view.querySelectorAll('[data-fan-action="reset-curve"]').length
    };
  })()`);

  assert.notStrictEqual(result.viewDisplay, 'none');
  assert.strictEqual(result.dashboardDisplay, 'none');
  assert(result.workspaceHeight > 400);
  assert.strictEqual(result.sections, 2);
  assert.strictEqual(result.controls, 3);
  assert.strictEqual(result.initialControls, 2);
  assert.strictEqual(result.controlsAfterShow, 3);
  assert.strictEqual(result.temperatures, 0);
  assert.strictEqual(result.charts, 1);
  assert(result.chartWidth > 400);
  assert.strictEqual(result.nodesAfterAdd, 5);
  assert.strictEqual(result.nodesAfterRemove, 4);
  assert.strictEqual(result.renamedSetting, 'Rear radiator');
  assert.strictEqual(result.incrementedOffset, 5);
  assert.strictEqual(result.collapsedContentDisplay, 'none');
  assert(result.collapsedCardHeight + 80 < result.expandedCardHeight);
  assert.strictEqual(result.cardHidden, true);
  assert.strictEqual(result.curveCollapsed, true);
  assert(result.headerAlignmentDelta <= 1);
  assert(result.headerActionWidthDelta <= 1);
  assert.strictEqual(result.allGlobal, true);
  assert.strictEqual(result.globalStudio, true);
  assert.strictEqual(result.resetButtons, 1);
  console.log(JSON.stringify(result, null, 2));
  window.destroy();
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
