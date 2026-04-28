import { execFile } from "node:child_process";
import { readFile, statfs } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { recordAuditEvent } from "../audit.js";
import type { PgPool } from "../db.js";

const execFileAsync = promisify(execFile);
const commandTimeoutMs = 2000;
const commandMaxBuffer = 256 * 1024;
const deployMetadataSource = "runtime/deploy.json";

const optionalDeployMetadataString = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed || null;
}, z.string().min(1).nullable().optional());

const deployMetadataSchema = z.object({
  schemaVersion: z.literal(1).optional(),
  branch: optionalDeployMetadataString,
  commit: optionalDeployMetadataString,
  deployedAt: optionalDeployMetadataString,
  appVersion: optionalDeployMetadataString
});

export type CollectorResult<T> =
  | {
      available: true;
      data: T;
      message?: string;
    }
  | {
      available: false;
      data: null;
      message: string;
    };

export interface OpsCollectors {
  services(): Promise<OpsServices>;
  system(): Promise<OpsSystem>;
  deploy(): Promise<OpsDeploy>;
}

export interface OpsServices {
  docker: CollectorResult<{
    containers: DockerContainerStatus[];
  }>;
  cloudflared: CollectorResult<{
    status: string;
  }>;
}

export interface DockerContainerStatus {
  name: string;
  image: string;
  status: string;
  health: string | null;
  uptime: string | null;
  localhostPorts: string[];
}

export interface OpsSystem {
  host: {
    platform: string;
    release: string;
    arch: string;
    uptimeSeconds: number;
  };
  memory: {
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    processRssBytes: number;
  };
  disk: CollectorResult<{
    path: string;
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
  }>;
}

export interface OpsDeploy {
  git: CollectorResult<{
    branch: string;
    commit: string;
    appVersion: string | null;
  }>;
  lastDeploy: CollectorResult<{
    deployedAt: string | null;
    source: string;
    appVersion: string | null;
  }>;
}

export function createDefaultOpsCollectors(): OpsCollectors {
  return {
    services: collectServices,
    system: collectSystem,
    deploy: collectDeploy
  };
}

export function registerOpsRoutes(server: FastifyInstance, pool: PgPool, collectors = createDefaultOpsCollectors()): void {
  server.get("/v1/ops/status", async (request) => {
    const [services, system, deploy] = await Promise.all([
      collectors.services(),
      collectors.system(),
      collectors.deploy()
    ]);

    const status = {
      status: summarizeStatus([
        services.docker,
        services.cloudflared,
        system.disk,
        deploy.git,
        deploy.lastDeploy
      ]),
      generatedAt: new Date().toISOString(),
      services,
      system,
      deploy,
      mode: "read_only"
    };

    await recordOpsReadAudit(pool, request, "/v1/ops/status");
    return status;
  });

  server.get("/v1/ops/services", async (request) => {
    const services = await collectors.services();
    await recordOpsReadAudit(pool, request, "/v1/ops/services");
    return {
      status: summarizeStatus([services.docker, services.cloudflared]),
      generatedAt: new Date().toISOString(),
      services,
      mode: "read_only"
    };
  });

  server.get("/v1/ops/system", async (request) => {
    const system = await collectors.system();
    await recordOpsReadAudit(pool, request, "/v1/ops/system");
    return {
      status: summarizeStatus([system.disk]),
      generatedAt: new Date().toISOString(),
      system,
      mode: "read_only"
    };
  });

  server.get("/v1/ops/deploy", async (request) => {
    const deploy = await collectors.deploy();
    await recordOpsReadAudit(pool, request, "/v1/ops/deploy");
    return {
      status: summarizeStatus([deploy.git, deploy.lastDeploy]),
      generatedAt: new Date().toISOString(),
      deploy,
      mode: "read_only"
    };
  });
}

async function collectServices(): Promise<OpsServices> {
  const [docker, cloudflared] = await Promise.all([collectDockerStatus(), collectCloudflaredStatus()]);
  return {
    docker,
    cloudflared
  };
}

async function collectDockerStatus(): Promise<OpsServices["docker"]> {
  const result = await runAllowlistedCommand("docker", ["ps", "--format", "{{json .}}"]);
  if (!result.available) {
    return result;
  }

  const containers = result.data.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseDockerContainerLine)
    .filter((container): container is DockerContainerStatus => Boolean(container));

  return available({
    containers
  });
}

async function collectCloudflaredStatus(): Promise<OpsServices["cloudflared"]> {
  const result = await runAllowlistedCommand("systemctl", ["is-active", "cloudflared"]);
  if (!result.available) {
    return result;
  }
  return available({
    status: result.data.stdout.trim() || "unknown"
  });
}

async function collectSystem(): Promise<OpsSystem> {
  const freeBytes = os.freemem();
  const totalBytes = os.totalmem();
  const processMemory = process.memoryUsage();

  return {
    host: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      uptimeSeconds: Math.round(os.uptime())
    },
    memory: {
      totalBytes,
      freeBytes,
      usedBytes: totalBytes - freeBytes,
      processRssBytes: processMemory.rss
    },
    disk: await collectDiskUsage(process.cwd())
  };
}

async function collectDiskUsage(path: string): Promise<OpsSystem["disk"]> {
  try {
    const stats = await statfs(path);
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bavail * stats.bsize;
    return available({
      path,
      totalBytes,
      freeBytes,
      usedBytes: totalBytes - freeBytes
    });
  } catch (error) {
    return unavailable(`Disk usage unavailable: ${errorMessage(error)}`);
  }
}

export async function collectDeploy(metadataPath = defaultDeployMetadataPath()): Promise<OpsDeploy> {
  const metadata = await readDeployMetadata(metadataPath);
  if (!metadata.available) {
    return {
      git: unavailable(metadata.message),
      lastDeploy: unavailable(metadata.message)
    };
  }

  const appVersion = metadata.data.appVersion ?? null;
  return {
    git:
      metadata.data.branch && metadata.data.commit
        ? available({
            branch: metadata.data.branch,
            commit: metadata.data.commit,
            appVersion
          })
        : unavailable("Git metadata unavailable in deploy metadata."),
    lastDeploy: metadata.data.deployedAt
      ? available({
          deployedAt: metadata.data.deployedAt,
          source: deployMetadataSource,
          appVersion
        })
      : unavailable("Deploy timestamp unavailable in deploy metadata.")
  };
}

async function readDeployMetadata(
  metadataPath: string
): Promise<CollectorResult<z.infer<typeof deployMetadataSchema>>> {
  let rawMetadata: string;
  try {
    rawMetadata = await readFile(metadataPath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return unavailable("Deploy metadata is not recorded yet.");
    }
    return unavailable(`Deploy metadata unavailable: ${errorMessage(error)}`);
  }

  let parsedMetadata: unknown;
  try {
    parsedMetadata = JSON.parse(rawMetadata);
  } catch {
    return unavailable("Deploy metadata is invalid.");
  }

  const result = deployMetadataSchema.safeParse(parsedMetadata);
  if (!result.success) {
    return unavailable("Deploy metadata is invalid.");
  }

  return available(result.data);
}

function defaultDeployMetadataPath(): string {
  return join(process.cwd(), deployMetadataSource);
}

async function runAllowlistedCommand(
  command: "docker" | "systemctl",
  args: readonly string[]
): Promise<CollectorResult<{ stdout: string }>> {
  try {
    const { stdout } = await execFileAsync(command, [...args], {
      timeout: commandTimeoutMs,
      maxBuffer: commandMaxBuffer,
      windowsHide: true
    });
    return available({
      stdout: sanitizeCommandOutput(stdout)
    });
  } catch (error) {
    return unavailable(`${command} information unavailable: ${errorMessage(error)}`);
  }
}

function parseDockerContainerLine(line: string): DockerContainerStatus | undefined {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const name = stringField(parsed.Names) || stringField(parsed.Name);
    const image = stringField(parsed.Image);
    const status = stringField(parsed.Status);
    if (!name || !image || !status) {
      return undefined;
    }

    return {
      name,
      image,
      status,
      health: parseDockerHealth(status),
      uptime: stringField(parsed.RunningFor) || null,
      localhostPorts: parseLocalhostPorts(stringField(parsed.Ports) ?? "")
    };
  } catch {
    return undefined;
  }
}

function parseDockerHealth(status: string): string | null {
  const match = status.match(/\((healthy|unhealthy|starting)\)/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function parseLocalhostPorts(ports: string): string[] {
  return ports
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("127.0.0.1:") || part.startsWith("localhost:"));
}

function sanitizeCommandOutput(value: string): string {
  return value.replace(/\r/g, "").slice(0, commandMaxBuffer);
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function summarizeStatus(results: Array<CollectorResult<unknown>>): "ok" | "partial" | "unavailable" {
  const availableCount = results.filter((result) => result.available).length;
  if (availableCount === results.length) {
    return "ok";
  }
  if (availableCount > 0) {
    return "partial";
  }
  return "unavailable";
}

async function recordOpsReadAudit(pool: PgPool, request: FastifyRequest, route: string): Promise<void> {
  await recordAuditEvent(pool, {
    actorType: "user",
    actorId: request.accessIdentity?.email ?? request.accessIdentity?.sub ?? "unknown",
    action: "ops.read",
    targetType: "ops",
    targetId: route,
    outcome: "success",
    metadata: {
      route,
      mode: "read_only"
    }
  }).catch((error) => {
    request.log.warn({ error, route }, "Failed to record ops read audit event.");
  });
}

function available<T>(data: T): CollectorResult<T> {
  return {
    available: true,
    data
  };
}

function unavailable<T>(message: string): CollectorResult<T> {
  return {
    available: false,
    data: null,
    message
  };
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown collector error";
}
