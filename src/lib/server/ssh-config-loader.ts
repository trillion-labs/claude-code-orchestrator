import { parse, LineType } from "ssh-config";
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import type { MachineConfig } from "../shared/types";

interface SSHConfigLine {
  type: number;
  param?: string;
  value?: string;
  config?: SSHConfigLine[];
}

export async function loadSSHHosts(): Promise<MachineConfig[]> {
  const configPath = join(homedir(), ".ssh", "config");

  try {
    const content = await readFile(configPath, "utf-8");
    const config = parse(content) as unknown as SSHConfigLine[];
    const machines: MachineConfig[] = [];

    for (const section of config) {
      if (section.type !== LineType.DIRECTIVE || section.param !== "Host") {
        continue;
      }

      const hostPattern = section.value as string;
      // Skip wildcard patterns
      if (hostPattern.includes("*") || hostPattern.includes("?")) {
        continue;
      }

      const hostname = findDirective(section, "HostName") || hostPattern;
      const port = findDirective(section, "Port");
      const user = findDirective(section, "User");
      const identityFile = findDirective(section, "IdentityFile");

      machines.push({
        id: `ssh-${hostPattern}`,
        name: hostPattern,
        type: "ssh",
        host: hostname,
        port: port ? parseInt(port, 10) : 22,
        username: user || undefined,
        identityFile: identityFile
          ? identityFile.replace(/^~/, homedir())
          : undefined,
        defaultWorkDir: "~",
      });
    }

    return machines;
  } catch (err) {
    console.warn("Could not load SSH config:", (err as Error).message);
    return [];
  }
}

function findDirective(section: SSHConfigLine, key: string): string | undefined {
  if (!section.config) return undefined;
  const keyLower = key.toLowerCase();
  for (const directive of section.config) {
    if (directive.type === LineType.DIRECTIVE && directive.param?.toLowerCase() === keyLower) {
      return directive.value;
    }
  }
  return undefined;
}
