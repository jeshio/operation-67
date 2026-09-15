/** Shared timing and capacity limits, in milliseconds unless named otherwise. */
export const NET = {
  version: 5, players: 4, tickRate: 60, inputRate: 30, snapshotRate: 20,
  checkpointMs: 250, heartbeatMs: 250, leaseMs: 1500, reconnectMs: 30_000,
  initialPrepareMs: 5000, prepareMs: 1000,
  probeMs: 1000, sampleWindowMs: 5000, directTimeoutMs: 500,
  improvementMs: 20, improvementRatio: .2, hostCooldownMs: 30_000,
  inputExpiryMs: 300, predictionMs: 500, queueFrames: 30,
  maxInputBytes: 4096, maxSignalBytes: 16_384, chunkBytes: 12_000,
  maxFrameBytes: 1_048_576, maxChunks: 96, assemblyMs: 500,
  maxBufferedBytes: 256_000, maxEvents: 512, maxIdentities: 128,
} as const;
