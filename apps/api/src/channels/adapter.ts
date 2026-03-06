/**
 * Platform-agnostic channel adapter interface.
 *
 * Every messaging platform (Slack, Discord, Teams, CLI) implements this
 * interface so the agent engine never depends on platform-specific SDKs.
 */
export interface ChannelAdapter {
  /** Send a text message in the given thread. */
  sendMessage(threadId: string, text: string): Promise<void>;

  /**
   * Request approval from the user before executing a tool.
   * Returns `true` if approved, `false` if denied or timed out.
   */
  requestApproval(params: {
    threadId: string;
    toolName: string;
    args: Record<string, unknown>;
  }): Promise<boolean>;

  /**
   * Request approval for multiple tools at once (batch).
   * Shown as a single consolidated message to the user.
   * Returns `true` if all approved, `false` if denied or timed out.
   * Falls back to sequential individual approvals if not implemented.
   */
  requestBatchApproval?(params: {
    threadId: string;
    tools: Array<{ toolName: string; args: Record<string, unknown> }>;
  }): Promise<boolean>;

  /**
   * Request approval for an execution plan (multi-step).
   * Returns `true` if approved, `false` if rejected or timed out.
   */
  requestPlanApproval(params: {
    threadId: string;
    planSummary: string;
    steps: string[];
  }): Promise<boolean>;

  /**
   * Format platform-specific user mentions from an array of user IDs.
   * Returns an empty string when the platform does not support mentions.
   */
  formatMentions?(userIds: string[]): string;
}
