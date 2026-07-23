'use strict';

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

let nativeApi;

function createNativeApi() {
  if (process.platform !== 'win32') return null;

  try {
    const koffi = require('koffi');
    const kernel32 = koffi.load('kernel32.dll');
    const PROCESS_MEMORY_COUNTERS_EX2 = koffi.struct('SIR_PROCESS_MEMORY_COUNTERS_EX2', {
      cb: 'uint32',
      PageFaultCount: 'uint32',
      PeakWorkingSetSize: 'uintptr_t',
      WorkingSetSize: 'uintptr_t',
      QuotaPeakPagedPoolUsage: 'uintptr_t',
      QuotaPagedPoolUsage: 'uintptr_t',
      QuotaPeakNonPagedPoolUsage: 'uintptr_t',
      QuotaNonPagedPoolUsage: 'uintptr_t',
      PagefileUsage: 'uintptr_t',
      PeakPagefileUsage: 'uintptr_t',
      PrivateUsage: 'uintptr_t',
      PrivateWorkingSetSize: 'uintptr_t',
      SharedCommitUsage: 'uint64'
    });

    return {
      structSize: koffi.sizeof(PROCESS_MEMORY_COUNTERS_EX2),
      openProcess: kernel32.func('void * __stdcall OpenProcess(uint32_t dwDesiredAccess, bool bInheritHandle, uint32_t dwProcessId)'),
      closeHandle: kernel32.func('bool __stdcall CloseHandle(void *hObject)'),
      getProcessMemoryInfo: kernel32.func('bool __stdcall K32GetProcessMemoryInfo(void *Process, _Inout_ SIR_PROCESS_MEMORY_COUNTERS_EX2 *ppsmemCounters, uint32_t cb)')
    };
  } catch (_error) {
    return null;
  }
}

function getNativeApi() {
  if (nativeApi === undefined) nativeApi = createNativeApi();
  return nativeApi;
}

function normalizeProcessIds(processIds) {
  return [...new Set((Array.isArray(processIds) ? processIds : [])
    .map((value) => Math.trunc(Number(value)))
    .filter((value) => Number.isInteger(value) && value > 0))];
}

function sampleWindowsPrivateWorkingSets(processIds, api = getNativeApi()) {
  const pids = normalizeProcessIds(processIds);
  const result = {
    supported: false,
    totalBytes: 0,
    processBytes: {}
  };

  if (!api || !pids.length) return result;

  let sampledCount = 0;
  pids.forEach((pid) => {
    let handle = null;
    try {
      handle = api.openProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
      if (!handle) return;

      const counters = { cb: api.structSize };
      if (!api.getProcessMemoryInfo(handle, counters, api.structSize)) return;

      const bytes = Math.max(0, Number(counters.PrivateWorkingSetSize) || 0);
      result.processBytes[pid] = bytes;
      result.totalBytes += bytes;
      sampledCount += 1;
    } catch (_error) {
      // A short-lived Electron utility process may exit between enumeration and
      // sampling. Skip it and retain the rest of the group.
    } finally {
      if (handle) {
        try {
          api.closeHandle(handle);
        } catch (_error) {}
      }
    }
  });

  result.supported = sampledCount > 0;
  return result;
}

module.exports = {
  PROCESS_QUERY_LIMITED_INFORMATION,
  normalizeProcessIds,
  sampleWindowsPrivateWorkingSets
};
