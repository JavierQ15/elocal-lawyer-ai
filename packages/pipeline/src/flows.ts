import { FlowProducer, type FlowJob, type JobsOptions } from "bullmq";
import {
  DEFAULT_STAGE_JOB_OPTIONS,
  JOB_NAMES,
  QUEUE_NAMES,
  type NormaStageJobData,
  type PipelineStage,
} from "./queues";

export const PIPELINE_STAGE_ORDER: PipelineStage[] = [
  "sync",
  "build_units",
  "build_chunks",
  "index",
];

interface BuildNormaFlowInput {
  idNorma: string;
  trigger: "backfill" | "resume";
  startFromStage?: PipelineStage;
}

function safeJobIdPart(value: string): string {
  return value.replace(/[:\s/\\]+/g, "_");
}

function stageJobOptions(stage: PipelineStage, idNorma: string): JobsOptions {
  return {
    ...DEFAULT_STAGE_JOB_OPTIONS,
    jobId: `${safeJobIdPart(stage)}__${safeJobIdPart(idNorma)}`,
  };
}

function buildSyncNode(data: NormaStageJobData): FlowJob {
  return {
    name: JOB_NAMES.syncNorma,
    queueName: QUEUE_NAMES.sync,
    data,
    opts: stageJobOptions("sync", data.id_norma),
  };
}

function buildUnitsNode(data: NormaStageJobData, includeSync: boolean): FlowJob {
  return {
    name: JOB_NAMES.buildUnidadesNorma,
    queueName: QUEUE_NAMES.build,
    data,
    opts: stageJobOptions("build_units", data.id_norma),
    children: includeSync ? [buildSyncNode(data)] : undefined,
  };
}

function buildChunksNode(
  data: NormaStageJobData,
  includeBuildUnits: boolean,
  includeSync: boolean,
): FlowJob {
  return {
    name: JOB_NAMES.buildChunksNorma,
    queueName: QUEUE_NAMES.build,
    data,
    opts: stageJobOptions("build_chunks", data.id_norma),
    children: includeBuildUnits ? [buildUnitsNode(data, includeSync)] : undefined,
  };
}

function buildIndexNode(
  data: NormaStageJobData,
  includeBuildChunks: boolean,
  includeBuildUnits = true,
  includeSync = true,
): FlowJob {
  return {
    name: JOB_NAMES.indexNorma,
    queueName: QUEUE_NAMES.index,
    data,
    opts: stageJobOptions("index", data.id_norma),
    children: includeBuildChunks
      ? [buildChunksNode(data, includeBuildUnits, includeSync)]
      : undefined,
  };
}

export function buildNormaFlow(input: BuildNormaFlowInput): FlowJob {
  const stage = input.startFromStage ?? "sync";
  const data: NormaStageJobData = {
    id_norma: input.idNorma,
    trigger: input.trigger,
  };

  if (stage === "sync") {
    return buildIndexNode(data, true, true, true);
  }

  if (stage === "build_units") {
    return buildIndexNode(data, true, true, false);
  }

  if (stage === "build_chunks") {
    return buildIndexNode(data, true, false, false);
  }

  return buildIndexNode(data, false, false, false);
}

export function isDuplicateJobError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /already exists|duplicat(e|ed)|job id/i.test(error.message);
}

export async function enqueueNormaFlow(
  flowProducer: FlowProducer,
  input: BuildNormaFlowInput,
): Promise<{ enqueued: boolean; reason?: "duplicate" }> {
  try {
    await flowProducer.add(buildNormaFlow(input));
    return { enqueued: true };
  } catch (error) {
    if (isDuplicateJobError(error)) {
      return {
        enqueued: false,
        reason: "duplicate",
      };
    }

    throw error;
  }
}
