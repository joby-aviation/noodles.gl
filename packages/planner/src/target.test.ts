import { describe, it, expect } from 'vitest';
import { targetCaps, TARGET_IDS, type TargetCaps } from './target.js';

/**
 * Capabilities are planner *inputs*, and two of them provably change plans (see
 * optimizer.test.ts). These tests pin the values. `deck-webgpu` used to report 8 storage
 * buffers on any adapter, because luma's device was created at WebGPU's default limits.
 * `DeckWebgpuPane` now asks luma for `featureLevel: 'max'` (every adapter limit), so every
 * compute target reads the limit off the device it is given.
 */

/** Minimal stand-in for the limits the caps reader consults. */
function fakeDevice(limits: Partial<GPUSupportedLimits>): GPUDevice {
  return {
    limits: {
      maxBufferSize: 1024 * 1024 * 1024,
      maxStorageBufferBindingSize: 256 * 1024 * 1024,
      maxStorageBuffersPerShaderStage: 10,
      ...limits,
    },
  } as unknown as GPUDevice;
}

describe('every target', () => {
  it.each(TARGET_IDS)('%s reports finite, sane capabilities', (id) => {
    const caps = targetCaps(id, undefined);
    expect(caps.id).toBe(id);
    expect(caps.label).toBeTruthy();
    expect(caps.note).toBeTruthy();
    expect(caps.gpuBudgetBytes).toBeGreaterThan(0);
    expect(Number.isFinite(caps.gpuBudgetBytes)).toBe(true);
    expect(caps.maxStorageBuffersPerStage).toBeGreaterThanOrEqual(4);
  });

  it('is deterministic without a device, so tests are reproducible', () => {
    for (const id of TARGET_IDS) {
      expect(targetCaps(id, undefined)).toEqual(targetCaps(id, undefined));
    }
  });

  it('covers exactly the three ids the demo offers', () => {
    expect([...TARGET_IDS].sort()).toEqual(['deck-webgl2', 'deck-webgpu', 'webgpu-native']);
  });
});

describe('compute availability', () => {
  it('only WebGL2 lacks compute', () => {
    expect(targetCaps('webgpu-native', undefined).compute).toBe(true);
    expect(targetCaps('deck-webgpu', undefined).compute).toBe(true);
    expect(targetCaps('deck-webgl2', undefined).compute).toBe(false);
  });

  it('explains itself when compute is missing', () => {
    // The optimizer surfaces this note when a capability, not a cost, forced a placement.
    expect(targetCaps('deck-webgl2', undefined).note).toMatch(/compute/i);
  });

  it('every target accepts app-owned buffers', () => {
    // True even on WebGL2: deck's BinaryAttribute takes a luma Buffer either way. What
    // differs is whether a compute shader can write it.
    for (const id of TARGET_IDS) {
      expect(targetCaps(id, undefined).appOwnedBuffers).toBe(true);
    }
  });
});

describe('gpu budget', () => {
  it('derives from device limits and holds back a render reserve', () => {
    const caps = targetCaps('webgpu-native', fakeDevice({ maxBufferSize: 512 * 1024 * 1024 }));
    expect(caps.gpuBudgetBytes).toBeLessThan(512 * 1024 * 1024);
    expect(caps.gpuBudgetBytes).toBeGreaterThan(256 * 1024 * 1024);
  });

  it('takes the smaller of the two relevant limits', () => {
    const tiny = targetCaps('webgpu-native', fakeDevice({
      maxBufferSize: 64 * 1024 * 1024,
      maxStorageBufferBindingSize: 1024 * 1024 * 1024,
    }));
    expect(tiny.gpuBudgetBytes).toBeLessThan(64 * 1024 * 1024);
  });

  it('scales with the device rather than being hardcoded', () => {
    const small = targetCaps('webgpu-native', fakeDevice({ maxBufferSize: 128 * 1024 * 1024 }));
    const large = targetCaps('webgpu-native', fakeDevice({ maxBufferSize: 1024 * 1024 * 1024 }));
    expect(large.gpuBudgetBytes).toBeGreaterThan(small.gpuBudgetBytes);
  });
});

describe('storage buffer limit', () => {
  it.each(TARGET_IDS)('%s uses the device’s limit', (id) => {
    expect(targetCaps(id, fakeDevice({ maxStorageBuffersPerShaderStage: 10 }))
      .maxStorageBuffersPerStage).toBe(10);
    expect(targetCaps(id, fakeDevice({ maxStorageBuffersPerShaderStage: 16 }))
      .maxStorageBuffersPerStage).toBe(16);
  });

  it.each(TARGET_IDS)('%s falls back to the spec minimum with no device', (id) => {
    expect(targetCaps(id, undefined).maxStorageBuffersPerStage).toBe(8);
  });

  it.each(TARGET_IDS)('%s falls back to the spec minimum when the limit is unreported', (id) => {
    const device = fakeDevice({ maxStorageBuffersPerShaderStage: undefined });
    expect(targetCaps(id, device).maxStorageBuffersPerStage).toBe(8);
  });
});

describe('caps are plain data', () => {
  it('can be overridden by a caller without a device', () => {
    // The tests and the browser suite both narrow caps this way; it must stay a value type.
    const caps: TargetCaps = { ...targetCaps('webgpu-native', undefined), maxStorageBuffersPerStage: 3 };
    expect(caps.maxStorageBuffersPerStage).toBe(3);
    expect(caps.compute).toBe(true);
  });

  it('holds no reference to the device it was read from', () => {
    const caps = targetCaps('webgpu-native', fakeDevice({}));
    expect(JSON.parse(JSON.stringify(caps))).toEqual(caps);
  });
});
