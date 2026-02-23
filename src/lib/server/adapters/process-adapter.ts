import { EventEmitter } from "events";

export abstract class ProcessAdapter extends EventEmitter {
  abstract spawn(command: string, args: string[], options?: { cwd?: string; env?: Record<string, string> }): Promise<void>;
  abstract write(data: string): void;
  abstract kill(): void;
  abstract get isRunning(): boolean;
}
