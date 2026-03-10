import { execFile } from "child_process";
import { promisify } from "util";
import type { GitHubIssue, GitHubComment, GitHubRepoInfo, GitHubLabel } from "../shared/types";

const execFileAsync = promisify(execFile);

/**
 * Manages GitHub issue operations via the `gh` CLI.
 * Each project has its own workDir which determines the GitHub repo context.
 */
export class GitHubManager {
  /**
   * Run a `gh` command in the given working directory.
   */
  private async gh(workDir: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("gh", args, {
      cwd: workDir,
      timeout: 30_000,
      env: { ...process.env, GH_NO_UPDATE_NOTIFIER: "1" },
    });
    return stdout.trim();
  }

  /**
   * Detect the GitHub repository from the working directory's git remote.
   */
  async detectRepo(workDir: string): Promise<GitHubRepoInfo | null> {
    try {
      const json = await this.gh(workDir, [
        "repo", "view", "--json", "owner,name,url",
      ]);
      const data = JSON.parse(json);
      return {
        owner: data.owner.login,
        repo: data.name,
        fullName: `${data.owner.login}/${data.name}`,
        url: data.url,
      };
    } catch {
      return null;
    }
  }

  /**
   * List issues for the repo detected from workDir.
   */
  async listIssues(
    workDir: string,
    opts?: { state?: "open" | "closed" | "all"; labels?: string[] }
  ): Promise<GitHubIssue[]> {
    const args = [
      "issue", "list",
      "--json", "number,title,body,state,labels,assignees,author,milestone,createdAt,updatedAt,closedAt,comments,url",
      "--limit", "100",
    ];

    if (opts?.state && opts.state !== "all") {
      args.push("--state", opts.state);
    } else if (opts?.state === "all") {
      args.push("--state", "all");
    }

    if (opts?.labels?.length) {
      args.push("--label", opts.labels.join(","));
    }

    const json = await this.gh(workDir, args);
    if (!json) return [];

    const raw = JSON.parse(json) as Array<Record<string, unknown>>;
    return raw.map((item) => this.mapIssue(item));
  }

  /**
   * Get a single issue by number.
   */
  async getIssue(workDir: string, issueNumber: number): Promise<GitHubIssue> {
    const json = await this.gh(workDir, [
      "issue", "view", String(issueNumber),
      "--json", "number,title,body,state,labels,assignees,author,milestone,createdAt,updatedAt,closedAt,comments,url",
    ]);
    const raw = JSON.parse(json);
    return this.mapIssue(raw);
  }

  /**
   * Create a new issue.
   */
  async createIssue(
    workDir: string,
    title: string,
    body: string,
    opts?: { labels?: string[]; assignees?: string[] }
  ): Promise<GitHubIssue> {
    const args = ["issue", "create", "--title", title, "--body", body];

    if (opts?.labels?.length) {
      for (const label of opts.labels) {
        args.push("--label", label);
      }
    }
    if (opts?.assignees?.length) {
      for (const assignee of opts.assignees) {
        args.push("--assignee", assignee);
      }
    }

    // gh issue create returns URL; parse number from it
    const url = await this.gh(workDir, args);
    const match = url.match(/\/issues\/(\d+)/);
    const issueNumber = match ? parseInt(match[1], 10) : 0;

    // Fetch the full issue data
    return this.getIssue(workDir, issueNumber);
  }

  /**
   * Update an existing issue.
   */
  async updateIssue(
    workDir: string,
    issueNumber: number,
    updates: {
      title?: string;
      body?: string;
      state?: "open" | "closed";
      labels?: string[];
      assignees?: string[];
    }
  ): Promise<GitHubIssue> {
    if (updates.state === "closed") {
      await this.gh(workDir, ["issue", "close", String(issueNumber)]);
    } else if (updates.state === "open") {
      await this.gh(workDir, ["issue", "reopen", String(issueNumber)]);
    }

    const editArgs = ["issue", "edit", String(issueNumber)];
    let hasEdits = false;

    if (updates.title) {
      editArgs.push("--title", updates.title);
      hasEdits = true;
    }
    if (updates.body) {
      editArgs.push("--body", updates.body);
      hasEdits = true;
    }
    if (updates.labels) {
      // --add-label replaces, so we need to handle this carefully
      // For simplicity, we use --add-label for each
      for (const label of updates.labels) {
        editArgs.push("--add-label", label);
      }
      hasEdits = true;
    }
    if (updates.assignees) {
      for (const assignee of updates.assignees) {
        editArgs.push("--add-assignee", assignee);
      }
      hasEdits = true;
    }

    if (hasEdits) {
      await this.gh(workDir, editArgs);
    }

    return this.getIssue(workDir, issueNumber);
  }

  /**
   * List comments on an issue.
   */
  async listComments(workDir: string, issueNumber: number): Promise<GitHubComment[]> {
    const json = await this.gh(workDir, [
      "issue", "view", String(issueNumber),
      "--json", "comments",
    ]);
    const data = JSON.parse(json);
    const comments = (data.comments || []) as Array<Record<string, unknown>>;
    return comments.map((c) => this.mapComment(c));
  }

  /**
   * Add a comment to an issue.
   */
  async addComment(workDir: string, issueNumber: number, body: string): Promise<GitHubComment> {
    await this.gh(workDir, [
      "issue", "comment", String(issueNumber), "--body", body,
    ]);

    // Fetch latest comments to get the one we just added
    const comments = await this.listComments(workDir, issueNumber);
    return comments[comments.length - 1];
  }

  /**
   * List available labels for the repo.
   */
  async listLabels(workDir: string): Promise<GitHubLabel[]> {
    const json = await this.gh(workDir, [
      "label", "list", "--json", "name,color,description", "--limit", "100",
    ]);
    if (!json) return [];

    const raw = JSON.parse(json) as Array<{ name: string; color: string; description?: string }>;
    return raw.map((l) => ({
      name: l.name,
      color: l.color,
      description: l.description,
    }));
  }

  private mapIssue(raw: Record<string, unknown>): GitHubIssue {
    const labels = (raw.labels as Array<Record<string, string>> || []).map((l) => ({
      name: l.name,
      color: l.color,
      description: l.description,
    }));

    const assignees = (raw.assignees as Array<Record<string, string>> || []).map((a) => ({
      login: a.login,
      avatarUrl: a.avatarUrl,
    }));

    const author = raw.author as Record<string, string> || {};
    const milestone = raw.milestone as Record<string, unknown> | null;

    const comments = raw.comments as Array<unknown> || [];

    return {
      number: raw.number as number,
      title: raw.title as string,
      body: (raw.body as string) || "",
      state: ((raw.state as string) || "OPEN").toLowerCase() === "closed" ? "closed" : "open",
      labels,
      assignees,
      author: { login: author.login || "unknown", avatarUrl: author.avatarUrl },
      milestone: milestone ? { title: milestone.title as string, number: milestone.number as number } : undefined,
      createdAt: raw.createdAt as string,
      updatedAt: raw.updatedAt as string,
      closedAt: raw.closedAt as string | undefined,
      commentsCount: comments.length,
      url: raw.url as string,
    };
  }

  private mapComment(raw: Record<string, unknown>): GitHubComment {
    const author = raw.author as Record<string, string> || {};
    return {
      id: (raw.id as number) || 0,
      body: (raw.body as string) || "",
      author: { login: author.login || "unknown", avatarUrl: author.avatarUrl },
      createdAt: raw.createdAt as string,
      updatedAt: raw.updatedAt as string || raw.createdAt as string,
    };
  }
}
