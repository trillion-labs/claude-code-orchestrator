import { spawn, type ChildProcess } from "child_process";
import { ProcessAdapter } from "./process-adapter";

export class LocalAdapter extends ProcessAdapter {
  private process: ChildProcess | null = null;

  async spawn(command: string, args: string[], options?: { cwd?: string; env?: Record<string, string> }): Promise<void> {
    const cwd = options?.cwd?.replace(/^~/, process.env.HOME || "/root");

    this.process = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...options?.env },
    });

    this.process.stdout?.on("data", (chunk: Buffer) => {
      this.emit("data", chunk.toString());
    });

    this.process.stderr?.on("data", (chunk: Buffer) => {
      this.emit("stderr", chunk.toString());
    });

    this.process.on("error", (err: Error) => {
      this.emit("error", err);
    });

    this.process.on("close", (code: number | null) => {
      this.process = null;
      this.emit("close", code);
    });
  }

  write(data: string): void {
    if (this.process?.stdin?.writable) {
      this.process.stdin.write(data);
    }
  }

  kill(): void {
    if (this.process) {
      this.process.kill("SIGTERM");
      // Force kill after timeout
      setTimeout(() => {
        if (this.process) {
          this.process.kill("SIGKILL");
        }
      }, 5000);
    }
  }

  get isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }
}
