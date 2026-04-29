export type SpiderGatewayStreamHandler = (event: unknown) => void;

type GatewayRequest =
  | {
      readonly type: "call";
      readonly id: string;
      readonly method: string;
      readonly payload?: unknown;
    }
  | {
      readonly type: "stream";
      readonly id: string;
      readonly method: string;
      readonly payload?: unknown;
    };

type GatewayResponse =
  | {
      readonly type: "success";
      readonly id: string;
      readonly payload?: unknown;
    }
  | {
      readonly type: "error";
      readonly id: string;
      readonly message: string;
    }
  | {
      readonly type: "event";
      readonly id: string;
      readonly event: unknown;
    };

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly onEvent?: SpiderGatewayStreamHandler;
}

export class SpiderGatewayClient {
  private readonly pending = new Map<string, PendingRequest>();

  constructor(readonly port: MessagePort) {
    this.port.onmessage = (event: MessageEvent<GatewayResponse>) => {
      const message = event.data;
      const pending = this.pending.get(message.id);
      if (!pending) return;

      switch (message.type) {
        case "event":
          pending.onEvent?.(message.event);
          break;
        case "success":
          this.pending.delete(message.id);
          pending.resolve(message.payload);
          break;
        case "error":
          this.pending.delete(message.id);
          pending.reject(new Error(message.message));
          break;
      }
    };
    this.port.start();
  }

  call<T = unknown>(method: string, payload?: unknown): Promise<T> {
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.port.postMessage({
        type: "call",
        id,
        method,
        payload,
      } satisfies GatewayRequest);
    });
  }

  stream<T = unknown>(
    method: string,
    payload: unknown,
    onEvent: SpiderGatewayStreamHandler,
  ): Promise<T> {
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        onEvent,
      });
      this.port.postMessage({
        type: "stream",
        id,
        method,
        payload,
      } satisfies GatewayRequest);
    });
  }
}

export function createSpiderGatewayClient(
  url: URL,
  options: { readonly name?: string } = {},
): SpiderGatewayClient {
  if (typeof SharedWorker === "undefined") {
    throw new Error("This browser does not support SharedWorker gateways.");
  }

  const worker = new SharedWorker(url, {
    name: options.name ?? "bud-spider-gateway",
    type: "module",
  });
  return new SpiderGatewayClient(worker.port);
}
