import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export function getWorkspaceRoot(): string {
  const configured = process.env.WORKSPACE_ROOT?.trim();
  if (configured && configured.length > 0) {
    return path.resolve(configured);
  }

  return process.cwd();
}

export async function runWorkspaceNodeScript(
  scriptPath: string,
  args: string[],
): Promise<void> {
  const workspaceRoot = getWorkspaceRoot();
  const absoluteScriptPath = path.resolve(workspaceRoot, scriptPath);

  await fs.access(absoluteScriptPath);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [absoluteScriptPath, ...args], {
      cwd: workspaceRoot,
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Command ${absoluteScriptPath} exited via signal ${signal}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`Command ${absoluteScriptPath} exited with code ${code ?? -1}`));
        return;
      }

      resolve();
    });
  });
}
