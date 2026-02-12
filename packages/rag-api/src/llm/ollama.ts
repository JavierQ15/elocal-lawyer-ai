export interface LlmChatMessage {
  role: "system" | "user";
  content: string;
}

export interface LlmChatClient {
  complete(messages: LlmChatMessage[]): Promise<string>;
}

export interface OllamaChatClientOptions {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  temperature: number;
}

interface OllamaChatResponse {
  message?: {
    role?: string;
    content?: string;
  };
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export class OllamaChatClient implements LlmChatClient {
  private readonly baseUrl: string;

  constructor(private readonly options: OllamaChatClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
  }

  async complete(messages: LlmChatMessage[]): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.options.model,
          stream: false,
          messages,
          options: {
            temperature: this.options.temperature,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`ollama chat failed (${response.status}): ${text}`);
      }

      const payload = (await response.json()) as OllamaChatResponse;
      const content = payload.message?.content?.trim();
      if (!content) {
        throw new Error("ollama chat response does not include message content");
      }

      return content;
    } finally {
      clearTimeout(timeout);
    }
  }
}
