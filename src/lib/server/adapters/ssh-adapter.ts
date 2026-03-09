import type { ClientChannel } from "ssh2";
import { ProcessAdapter } from "./process-adapter";
import { SSHConnectionManager } from "../ssh-manager";
import type { MachineConfig } from "../../shared/types";

export class SSHAdapter extends ProcessAdapter {
  private channel: ClientChannel | null = null;
  private _isRunning = false;

  constructor(
    private sshManager: SSHConnectionManager,
    private machine: MachineConfig
  ) {
    super();
  }

  async spawn(command: string, args: string[], options?: { cwd?: string; env?: Record<string, string> }): Promise<void> {
    const parts: string[] = [];
    // Ensure ~/.local/bin is in PATH (common Claude CLI install location)
    parts.push('export PATH="$HOME/.local/bin:$PATH"');
    // Set any explicit environment variables
    if (options?.env) {
      for (const [key, value] of Object.entries(options.env)) {
        parts.push(`export ${key}=${JSON.stringify(value)}`);
      }
    }
    if (options?.cwd) {
      parts.push(`cd ${options.cwd}`);
    }
    // Load direnv .envrc if available (sets CLAUDE_CONFIG_DIR etc. on shared machines)
    parts.push('eval "$(direnv export bash 2>/dev/null)"');
    parts.push(`${command} ${args.join(" ")}`);
    const fullCommand = parts.join(" && ");

    console.log(`[SSH Spawn] ${fullCommand}`);
    this.channel = await this.sshManager.exec(this.machine, fullCommand);
    this._isRunning = true;

    this.channel.on("data", (data: Buffer) => {
      this.emit("data", data.toString());
    });

    this.channel.stderr.on("data", (data: Buffer) => {
      this.emit("stderr", data.toString());
    });

    this.channel.on("close", (code: number | null) => {
      this._isRunning = false;
      this.channel = null;
      this.emit("close", code);
    });

    this.channel.on("error", (err: Error) => {
      this._isRunning = false;
      this.emit("error", err);
    });
  }

  write(data: string): void {
    if (this.channel?.writable) {
      this.channel.write(data);
    }
  }

  interrupt(): void {
    if (this.channel) {
      this.channel.signal("INT");
    }
  }

  kill(): void {
    if (this.channel) {
      this.channel.signal("TERM");
      this.channel.close();
      this._isRunning = false;
      this.channel = null;
    }
  }

  get isRunning(): boolean {
    return this._isRunning;
  }
}
