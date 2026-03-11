import { Client, type ConnectConfig, type ClientChannel } from "ssh2";
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { createConnection } from "net";
import { EventEmitter } from "events";
import type { MachineConfig } from "../shared/types";

interface SSHConnection {
  client: Client;
  config: MachineConfig;
  connected: boolean;
  lastUsed: number;
  reversePort?: number; // Reverse-forwarded port on the remote machine
}

export class SSHConnectionManager extends EventEmitter {
  private connections = new Map<string, SSHConnection>();
  private privateKeyCache: Buffer | null = null;

  async getConnection(machine: MachineConfig): Promise<Client> {
    const existing = this.connections.get(machine.id);
    if (existing?.connected) {
      existing.lastUsed = Date.now();
      return existing.client;
    }

    return this.connect(machine);
  }

  private async connect(machine: MachineConfig): Promise<Client> {
    const client = new Client();
    const privateKey = await this.getPrivateKey(machine.identityFile);

    const config: ConnectConfig = {
      host: machine.host,
      port: machine.port || 22,
      username: machine.username || process.env.USER || "root",
      ...(privateKey ? { privateKey } : {}),
      ...(process.env.SSH_AUTH_SOCK ? { agent: process.env.SSH_AUTH_SOCK } : {}),
      keepaliveInterval: 30000,
      keepaliveCountMax: 3,
      readyTimeout: 10000,
    };

    return new Promise((resolve, reject) => {
      client.on("ready", () => {
        console.log(`[SSH] Connected to ${machine.name}`);
        this.connections.set(machine.id, {
          client,
          config: machine,
          connected: true,
          lastUsed: Date.now(),
        });
        resolve(client);
      });

      client.on("error", (err) => {
        console.error(`[SSH] Error on ${machine.name}:`, err.message);
        this.connections.delete(machine.id);
        reject(err);
      });

      client.on("close", () => {
        console.log(`[SSH] Disconnected from ${machine.name}`);
        const conn = this.connections.get(machine.id);
        if (conn) {
          conn.connected = false;
        }
        this.emit("disconnected", machine.id);
      });

      client.connect(config);
    });
  }

  async exec(machine: MachineConfig, command: string): Promise<ClientChannel> {
    const client = await this.getConnection(machine);
    return new Promise((resolve, reject) => {
      client.exec(command, { pty: false }, (err, channel) => {
        if (err) return reject(err);
        resolve(channel);
      });
    });
  }

  /**
   * Execute a command using a fresh (temporary) SSH connection.
   * Use when the main connection has forwardIn active (which can block exec).
   */
  async execFresh(machine: MachineConfig, command: string): Promise<ClientChannel> {
    const client = new Client();
    const privateKey = await this.getPrivateKey(machine.identityFile);

    const config: ConnectConfig = {
      host: machine.host,
      port: machine.port || 22,
      username: machine.username || process.env.USER || "root",
      ...(privateKey ? { privateKey } : {}),
      ...(process.env.SSH_AUTH_SOCK ? { agent: process.env.SSH_AUTH_SOCK } : {}),
      readyTimeout: 10000,
    };

    const readyClient = await new Promise<Client>((resolve, reject) => {
      client.on("ready", () => resolve(client));
      client.on("error", reject);
      client.connect(config);
    });

    return new Promise((resolve, reject) => {
      readyClient.exec(command, { pty: false }, (err, channel) => {
        if (err) {
          readyClient.end();
          return reject(err);
        }
        // Auto-close temp connection when channel closes
        channel.on("close", () => readyClient.end());
        resolve(channel);
      });
    });
  }

  async healthCheck(machine: MachineConfig): Promise<{ ok: boolean; version?: string; error?: string }> {
    try {
      const channel = await this.exec(machine, "export PATH=\"$HOME/.local/bin:$PATH\" && which claude && claude --version 2>/dev/null");
      return new Promise((resolve) => {
        let output = "";
        channel.on("data", (data: Buffer) => {
          output += data.toString();
        });
        channel.on("close", () => {
          if (output.includes("claude")) {
            resolve({ ok: true, version: output.trim() });
          } else {
            resolve({ ok: false, error: "Claude CLI not found" });
          }
        });
        channel.on("error", (err: Error) => {
          resolve({ ok: false, error: err.message });
        });
      });
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /**
   * Set up reverse port forwarding: remote 127.0.0.1:PORT → local 127.0.0.1:localPort
   * Returns the remote port number. Reuses existing forward if already set up.
   */
  async setupReversePortForward(machine: MachineConfig, localPort: number): Promise<number> {
    const conn = this.connections.get(machine.id);
    if (conn?.reversePort) return conn.reversePort;

    const client = await this.getConnection(machine);

    return new Promise((resolve, reject) => {
      client.forwardIn("127.0.0.1", 0, (err, port) => {
        if (err) return reject(err);

        const c = this.connections.get(machine.id);
        if (c) c.reversePort = port;

        console.log(`[SSH] Reverse port forward: ${machine.name} 127.0.0.1:${port} → local 127.0.0.1:${localPort}`);
        resolve(port);
      });

      // Handle incoming connections on the forwarded port → pipe to local orchestrator
      client.on("tcp connection", (info, accept) => {
        const channel = accept();
        const socket = createConnection({ port: localPort, host: "127.0.0.1" }, () => {
          channel.pipe(socket);
          socket.pipe(channel);
        });
        socket.on("error", () => { try { channel.close(); } catch {} });
        channel.on("error", () => { try { socket.destroy(); } catch {} });
      });
    });
  }

  /**
   * Write a file to a remote machine via SFTP.
   * Works even after forwardIn (unlike exec which hangs).
   */
  async writeRemoteFile(machine: MachineConfig, remotePath: string, content: string, opts?: { mode?: number }): Promise<void> {
    const client = await this.getConnection(machine);
    return new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) return reject(err);
        const stream = sftp.createWriteStream(remotePath, { mode: opts?.mode ?? 0o644 });
        stream.on("close", () => {
          sftp.end();
          resolve();
        });
        stream.on("error", (e: Error) => {
          sftp.end();
          reject(e);
        });
        stream.end(content);
      });
    });
  }

  disconnect(machineId: string) {
    const conn = this.connections.get(machineId);
    if (conn) {
      conn.client.end();
      this.connections.delete(machineId);
    }
  }

  disconnectAll() {
    for (const [id] of this.connections) {
      this.disconnect(id);
    }
  }

  private async getPrivateKey(identityFile?: string): Promise<Buffer | undefined> {
    // 1. SSH config IdentityFile — try specified key first
    if (identityFile) {
      try {
        return await readFile(identityFile);
      } catch {
        console.warn(`[SSH] Identity file not found: ${identityFile}, trying defaults`);
      }
    }

    // 2-3. Default keys (cached): id_rsa → id_ed25519
    if (this.privateKeyCache) return this.privateKeyCache;

    const keyPath = join(homedir(), ".ssh", "id_rsa");
    try {
      this.privateKeyCache = await readFile(keyPath);
      return this.privateKeyCache;
    } catch {
      try {
        const ed25519Path = join(homedir(), ".ssh", "id_ed25519");
        this.privateKeyCache = await readFile(ed25519Path);
        return this.privateKeyCache;
      } catch {
        // 4. No key files found — fall back to SSH agent (via SSH_AUTH_SOCK)
        console.warn("[SSH] No private key files found, relying on SSH agent");
        return undefined;
      }
    }
  }
}
