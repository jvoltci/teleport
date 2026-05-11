/**
 * Raw WebSocket signaling client.
 *
 * Wire protocol: JSON messages over a single WebSocket at /ws.
 * Each request from the client carries a `reqId`; the server replies
 * with `{ type: "ack", reqId, ... }` so we can match request to response.
 *
 * Server-pushed events (no reqId): `answer-received`, `ice-candidate`,
 * `peer-disconnected`.
 */

type AckPayload = {
  type: "ack";
  reqId: string;
  success?: boolean;
  error?: string;
  [k: string]: unknown;
};

type ServerEvent =
  | { type: "answer-received"; answer: RTCSessionDescriptionInit; answerCandidates: RTCIceCandidateInit[] }
  | { type: "ice-candidate"; candidate: RTCIceCandidateInit }
  | { type: "peer-disconnected" }
  | AckPayload;

type EventListener = (msg: ServerEvent) => void;

export class SignalingClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reqCounter = 0;
  private pending = new Map<string, (msg: AckPayload) => void>();
  private listeners = new Set<EventListener>();
  private connected: Promise<void>;

  constructor(url: string) {
    this.url = url;
    this.connected = this.connect();
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(new Error(`WebSocket error: ${String(e)}`));
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as ServerEvent;
          if (msg.type === "ack") {
            const handler = this.pending.get(msg.reqId);
            if (handler) {
              this.pending.delete(msg.reqId);
              handler(msg);
            }
          } else {
            this.listeners.forEach((l) => l(msg));
          }
        } catch (err) {
          console.warn("[Signaling] Bad message:", err);
        }
      };
      ws.onclose = () => {
        this.ws = null;
      };
    });
  }

  private nextReqId(): string {
    this.reqCounter += 1;
    return `r-${this.reqCounter}`;
  }

  async request<T = AckPayload>(
    type: string,
    data: Record<string, unknown>
  ): Promise<T> {
    await this.connected;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Signaling socket is not open");
    }
    const reqId = this.nextReqId();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(reqId, (ack) => {
        if (ack.error) reject(new Error(ack.error));
        else resolve(ack as unknown as T);
      });
      this.ws!.send(JSON.stringify({ reqId, type, data }));
      // Timeout for safety
      setTimeout(() => {
        if (this.pending.has(reqId)) {
          this.pending.delete(reqId);
          reject(new Error(`Signaling request "${type}" timed out`));
        }
      }, 10_000);
    });
  }

  async send(type: string, data: Record<string, unknown>): Promise<void> {
    await this.connected;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type, data }));
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.listeners.clear();
    this.pending.clear();
    this.ws?.close();
    this.ws = null;
  }
}

export function getSignalingUrl(): string {
  const url = process.env.NEXT_PUBLIC_SIGNALING_URL;
  if (url) return url.replace(/\/+$/, "") + "/ws";
  // Sensible dev default
  return "ws://localhost:4000/ws";
}
