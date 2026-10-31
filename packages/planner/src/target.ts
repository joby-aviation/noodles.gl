/**
 * Render targets described by capability, not by product name.
 *
 * The planner should not know whether it is feeding "our renderer" or "deck.gl". What
 * changes its decisions is whether compute shaders exist and whether the renderer will
 * accept a buffer the application allocated. Naming the input that way collapses what
 * looked like three separate integrations into one axis with two bits.
 *
 * The distinction that matters here is *not* deck vs not-deck. deck.gl 9.4 already ships
 * `@luma.gl/webgpu` (`webgpuAdapter`, `WebGPUDevice`) and `@luma.gl/gpgpu`, and
 * `@luma.gl/core`'s `Device` declares `createComputePipeline` and `beginComputePass`. So
 * deck under a WebGPU device has the same capabilities as our own renderer; deck under
 * WebGL2 differs only by lacking compute.
 */

export type TargetId = 'webgpu-native' | 'deck-webgpu' | 'deck-webgl2';

export interface TargetCaps {
  id: TargetId;
  label: string;
  /** Compute shaders available, so a GPU stage exists at all. */
  compute: boolean;
  /** The renderer will bind buffers it did not allocate. */
  appOwnedBuffers: boolean;
  /** Attribute bytes that may be resident. A plan needing more is infeasible. */
  gpuBudgetBytes: number;
  /**
   * Storage buffers bindable in one compute stage.
   *
   * A fused kernel binds one per attribute it reads or writes, plus one for the color LUT,
   * so this is reached quickly: four source columns, four derived attributes and a ramp is
   * nine, and the WebGPU default is eight. It is a hard constraint, not a cost, so the
   * optimizer rejects candidates that exceed it rather than pricing them.
   */
  maxStorageBuffersPerStage: number;
  /**
   * A GPU stream-compaction engine is available: a filter in the `compactable` subset can
   * remove rows on the GPU and hand the renderer a compacted id list plus a GPU-resident
   * count for `drawIndirect`. Without it a GPU-stage filter can only be a discard mask.
   *
   * No built-in target has it. It depends on the host supplying an engine (the runtime's
   * `compactor` option, which `src/luma` fills with luma.gl's GPU Dataframe), so the host
   * turns it on — see `withCompaction`.
   */
  compaction: boolean;
  /**
   * The renderer reads positions as hi/lo f32 pairs, a 24-byte stride for a vec3. deck's
   * `ScatterplotLayer` declares `getPosition` as float64, and on WebGPU deck emulates that as
   * `[hi.xyz, lo.xyz]` per row; a float32x3 buffer is rejected as half the size. With this set,
   * every producer of the position channel writes that layout (`positionFormat`).
   */
  fp64Positions: boolean;
  /** Shown in the EXPLAIN pane when a capability, not a cost, forced a placement. */
  note: string;
}

/** Fraction of the device's buffer limit left for render targets and scratch. */
const RENDER_RESERVE = 0.25;

/** WebGPU's guaranteed minimum for `maxStorageBuffersPerShaderStage`. */
const WEBGPU_DEFAULT_STORAGE_BUFFERS = 8;

/**
 * The four limits the planner reads off a device, described structurally.
 *
 * A real `GPUDevice` satisfies this, but naming that type here would make `@webgpu/types` a
 * requirement for anyone importing the planner — including a consumer planning on a server,
 * where there is no device at all. Structural typing means `targetCaps(id, device)` still
 * accepts a `GPUDevice` without the planner ever depending on WebGPU's type declarations.
 */
export interface DeviceLimits {
  limits: {
    maxBufferSize: number;
    maxStorageBufferBindingSize: number;
    maxStorageBuffersPerShaderStage: number;
  };
}

export function targetCaps(id: TargetId, device: DeviceLimits | undefined): TargetCaps {
  // Without a device (unit tests) assume a modest budget so tests are deterministic.
  const limit = device
    ? Math.min(device.limits.maxBufferSize, device.limits.maxStorageBufferBindingSize * 4)
    : 512 * 1024 * 1024;
  const budget = Math.floor(limit * (1 - RENDER_RESERVE));
  const storageBuffers =
    device?.limits.maxStorageBuffersPerShaderStage ?? WEBGPU_DEFAULT_STORAGE_BUFFERS;

  switch (id) {
    case 'webgpu-native':
      return {
        id,
        label: 'webgpu (this graph)',
        compute: true,
        appOwnedBuffers: true,
        gpuBudgetBytes: budget,
        maxStorageBuffersPerStage: storageBuffers,
        compaction: false,
        fp64Positions: false,
        note: 'compute + app-owned buffers',
      };
    case 'deck-webgpu':
      return {
        id,
        label: 'deck.gl on webgpu',
        compute: true,
        appOwnedBuffers: true,
        gpuBudgetBytes: budget,
        // This used to be pinned to the WebGPU default of 8: luma's device ran at default
        // limits because nothing asked for more. `DeckWebgpuPane` now creates it with
        // `featureLevel: 'max'`, which requests every adapter limit, so deck's device has
        // the same limit as the device passed here. luma 9.4 still cannot attach deck to
        // that device (no `attach()`), so the two are separate devices on the same adapter.
        maxStorageBuffersPerStage: storageBuffers,
        compaction: false,
        fp64Positions: true,
        note: 'luma webgpuAdapter: compute + app-owned buffers, device created at the adapter’s limits',
      };
    case 'deck-webgl2':
      return {
        id,
        label: 'deck.gl on webgl2',
        compute: false,
        appOwnedBuffers: true,
        gpuBudgetBytes: budget,
        maxStorageBuffersPerStage: storageBuffers,
        compaction: false,
        // deck on WebGL2 has real 64-bit attributes and splits a Float64Array itself.
        fp64Positions: false,
        note: 'no compute shaders on WebGL2, so the GPU stage is unavailable',
      };
  }
}

/**
 * The same target with a compaction engine attached. Meaningless without compute, so a
 * target lacking it is returned unchanged.
 */
export function withCompaction(caps: TargetCaps): TargetCaps {
  if (!caps.compute) return caps;
  return { ...caps, compaction: true, note: `${caps.note}; GPU compaction available` };
}

export const TARGET_IDS: TargetId[] = ['webgpu-native', 'deck-webgpu', 'deck-webgl2'];
