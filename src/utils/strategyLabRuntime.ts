/**
 * Strategy Lab Assistant UI Runtime
 *
 * 连接 Python 后端，实现流式消息处理
 */

import { AssistantRuntime, ExternalStoreAdapter } from "@assistant-ui/react";
import { StrategyLabBackend } from "./strategyLabBackend";

export type StrategyLabMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};

export type StrategyLabArtifact = {
  type: "code_package" | "backtest_run";
  id: string;
  title: string;
  createdAt: string;
  [key: string]: unknown;
};

export type StrategyLabThread = {
  id: string;
  title: string;
  messages: StrategyLabMessage[];
  artifacts: StrategyLabArtifact[];
  activeArtifactId?: string;
};

/**
 * Strategy Lab Runtime
 *
 * 将 Python 后端的 Strategy Lab 会话转换为 assistant-ui 的运行时
 */
export class StrategyLabRuntime implements ExternalStoreAdapter {
  private thread: StrategyLabThread;
  private backend: StrategyLabBackend;
  private subscribers: Set<() => void> = new Set();

  constructor(thread: StrategyLabThread, backend: StrategyLabBackend) {
    this.thread = thread;
    this.backend = backend;
  }

  /**
   * 获取当前线程
   */
  getThread(): StrategyLabThread {
    return this.thread;
  }

  /**
   * 获取消息列表（assistant-ui格式）
   */
  getMessages() {
    return this.thread.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: [
        {
          type: "text",
          text: message.content,
        },
      ],
      createdAt: new Date(message.createdAt),
    }));
  }

  /**
   * 添加新消息
   */
  async addNewUserMessage(content: string) {
    // 1. 乐观更新：立即显示用户消息
    const userMessage: StrategyLabMessage = {
      id: `temp-user-${Date.now()}`,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };

    this.thread.messages.push(userMessage);
    this.notifySubscribers();

    // 2. 调用后端，获取真实响应
    try {
      const response = await this.backend.sendMessage(this.thread.id, content);

      // 3. 替换临时消息为真实消息
      this.thread.messages = response.messages;
      this.thread.artifacts = response.artifacts;

      // 4. 如果有新的 artifact，创建 assistant 消息
      if (response.artifacts.length > 0) {
        const lastArtifact = response.artifacts[response.artifacts.length - 1];
        const assistantMessage: StrategyLabMessage = {
          id: `assistant-${lastArtifact.id}`,
          role: "assistant",
          content: `已生成 ${lastArtifact.type === "code_package" ? "代码包" : "回测快照"}：${lastArtifact.title}`,
          createdAt: new Date().toISOString(),
        };
        this.thread.messages.push(assistantMessage);
      }

      this.notifySubscribers();
    } catch (error) {
      // 错误处理：显示错误消息
      const errorMessage: StrategyLabMessage = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: `错误：${error instanceof Error ? error.message : "请求失败"}`,
        createdAt: new Date().toISOString(),
      };
      this.thread.messages.push(errorMessage);
      this.notifySubscribers();
    }
  }

  /**
   * 注册订阅者（assistant-ui内部使用）
   */
  subscribe(callback: () => void) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  /**
   * 通知所有订阅者
   */
  private notifySubscribers() {
    this.subscribers.forEach((callback) => callback());
  }

  /**
   * 获取线程ID
   */
  getThreadId(): string {
    return this.thread.id;
  }

  /**
   * 切换到新线程
   */
  switchToThread(threadId: string) {
    // 加载新线程的数据
    this.backend.getSession(threadId).then((data) => {
      this.thread = {
        id: threadId,
        title: data.session.title,
        messages: data.messages,
        artifacts: data.artifacts,
        activeArtifactId: data.session.activeArtifactId,
      };
      this.notifySubscribers();
    });
  }

  /**
   * 获取 artifacts（用于自定义渲染）
   */
  getArtifacts(): StrategyLabArtifact[] {
    return this.thread.artifacts;
  }

  /**
   * 获取当前激活的 artifact
   */
  getActiveArtifact(): StrategyLabArtifact | undefined {
    if (!this.thread.activeArtifactId) return undefined;
    return this.thread.artifacts.find((a) => a.id === this.thread.activeArtifactId);
  }

  /**
   * 设置激活的 artifact
   */
  setActiveArtifact(artifactId: string | undefined) {
    this.thread.activeArtifactId = artifactId;
    this.notifySubscribers();
  }

  /**
   * 运行回测
   */
  async runBacktest(artifactId: string) {
    const artifact = this.thread.artifacts.find((a) => a.id === artifactId);
    if (!artifact || artifact.type !== "code_package") {
      throw new Error("Only code_package can run backtest");
    }

    // 添加等待消息
    const pendingMessage: StrategyLabMessage = {
      id: `pending-backtest-${Date.now()}`,
      role: "assistant",
      content: "正在运行回测...",
      createdAt: new Date().toISOString(),
    };
    this.thread.messages.push(pendingMessage);
    this.notifySubscribers();

    try {
      const result = await this.backend.runArtifact(artifactId, {});

      // 替换等待消息为完成消息
      this.thread.messages = this.thread.messages.filter(
        (m) => m.id !== pendingMessage.id
      );

      const completeMessage: StrategyLabMessage = {
        id: `backtest-complete-${result.artifact.id}`,
        role: "assistant",
        content: `回测完成：${result.artifact.title}`,
        createdAt: new Date().toISOString(),
      };
      this.thread.messages.push(completeMessage);

      // 添加新的 artifact
      this.thread.artifacts.push(result.artifact);
      this.thread.activeArtifactId = result.artifact.id;

      this.notifySubscribers();
    } catch (error) {
      // 错误处理
      this.thread.messages = this.thread.messages.filter(
        (m) => m.id !== pendingMessage.id
      );

      const errorMessage: StrategyLabMessage = {
        id: `backtest-error-${Date.now()}`,
        role: "assistant",
        content: `回测失败：${error instanceof Error ? error.message : "未知错误"}`,
        createdAt: new Date().toISOString(),
      };
      this.thread.messages.push(errorMessage);
      this.notifySubscribers();
    }
  }
}

/**
 * Strategy Lab Backend API封装
 */
export class StrategyLabBackend {
  async listSessions() {
    const response = await fetch("/api/strategy-lab/sessions");
    const data = await response.json();
    return data.sessions as StrategyLabThread[];
  }

  async createSession(title?: string) {
    const response = await fetch("/api/strategy-lab/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const data = await response.json();
    return {
      id: data.session.id,
      title: data.session.title,
      messages: data.messages,
      artifacts: data.artifacts,
    } as StrategyLabThread;
  }

  async getSession(sessionId: string) {
    const response = await fetch(`/api/strategy-lab/sessions/${sessionId}`);
    const data = await response.json();
    return data as {
      session: { id: string; title: string; activeArtifactId?: string };
      messages: StrategyLabMessage[];
      artifacts: StrategyLabArtifact[];
    };
  }

  async sendMessage(sessionId: string, content: string) {
    const response = await fetch(`/api/strategy-lab/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
    const data = await response.json();
    return {
      messages: data.messages,
      artifacts: data.artifacts,
    };
  }

  async runArtifact(artifactId: string, payload: Record<string, unknown>) {
    const response = await fetch(`/api/strategy-lab/artifacts/${artifactId}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    return {
      artifact: data.artifact,
      message: data.message,
    };
  }
}

/**
 * 创建 Strategy Lab Runtime
 */
export function createStrategyLabRuntime(
  thread: StrategyLabThread
): AssistantRuntime {
  const backend = new StrategyLabBackend();
  const adapter = new StrategyLabRuntime(thread, backend);

  return new AssistantRuntime(adapter);
}