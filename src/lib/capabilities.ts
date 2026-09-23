import type { Bindings } from "@/types/env";

export interface DubCapabilities {
  jobIntake: boolean;
  upload: boolean;
  jobProcessing: boolean;
  outputDownload: boolean;
}

/**
 * Explicit deployment switch. It must only be enabled when a real queue
 * consumer is deployed and monitoring the shared dub_jobs table.
 */
export function isDubProcessorReady(env: Bindings): boolean {
  return env.DUB_PROCESSOR_ENABLED === "true";
}

export function dubCapabilities(env: Bindings, schemaReady: boolean): DubCapabilities {
  const jobProcessing = isDubProcessorReady(env);
  return {
    jobIntake: schemaReady && jobProcessing,
    upload: schemaReady && jobProcessing,
    jobProcessing: schemaReady && jobProcessing,
    outputDownload: schemaReady,
  };
}
