import { EventEmitter } from "events";
import type { ClaudeStreamMessage } from "../shared/types";

export class StreamParser extends EventEmitter {
  private buffer = "";

  feed(chunk: string) {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    // Keep the last potentially incomplete line in the buffer
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      this.parseLine(trimmed);
    }
  }

  private parseLine(line: string) {
    try {
      const parsed = JSON.parse(line) as ClaudeStreamMessage;
      this.emit("message", parsed);
    } catch {
      // Not valid JSON - might be stderr or debug output
      this.emit("stderr", line);
    }
  }

  flush() {
    if (this.buffer.trim()) {
      this.parseLine(this.buffer.trim());
      this.buffer = "";
    }
  }

  reset() {
    this.buffer = "";
  }
}
