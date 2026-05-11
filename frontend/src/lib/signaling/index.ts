import { SignalingClient, getSignalingUrl } from "./ws-client";
import type {
  SignalingAdapter,
  SignalHost,
  SignalJoiner,
} from "./types";

export type { SignalingAdapter, SignalHost, SignalJoiner } from "./types";

class WSHost implements SignalHost {
  constructor(private client: SignalingClient) {}

  async createRoom(
    code: string,
    offer: RTCSessionDescriptionInit,
    iceCandidates: RTCIceCandidate[]
  ): Promise<void> {
    await this.client.request("create-room", { code, offer, iceCandidates });
  }

  private offEvent: (() => void) | null = null;

  waitForAnswer(
    _code: string,
    onAnswer: (
      answer: RTCSessionDescriptionInit,
      answerCandidates: RTCIceCandidateInit[]
    ) => void
  ): void {
    this.offEvent = this.client.onEvent((msg) => {
      if (msg.type === "answer-received") {
        onAnswer(msg.answer, msg.answerCandidates);
      }
    });
  }

  cleanup(): void {
    this.offEvent?.();
    this.offEvent = null;
  }
}

class WSJoiner implements SignalJoiner {
  constructor(private client: SignalingClient) {}

  async fetchOffer(code: string): Promise<{
    offer: RTCSessionDescriptionInit;
    offerCandidates: RTCIceCandidateInit[];
  }> {
    const ack = await this.client.request<{
      success?: boolean;
      offer?: RTCSessionDescriptionInit;
      offerCandidates?: RTCIceCandidateInit[];
    }>("join-room", { code });
    if (!ack.offer || !ack.offerCandidates) {
      throw new Error("Session not found. Check the code and try again.");
    }
    return { offer: ack.offer, offerCandidates: ack.offerCandidates };
  }

  async submitAnswer(
    code: string,
    answer: RTCSessionDescriptionInit,
    iceCandidates: RTCIceCandidate[]
  ): Promise<void> {
    await this.client.send("submit-answer", { code, answer, iceCandidates });
  }

  cleanup(): void {
    // no-op
  }
}

export function createSignalingAdapter(): SignalingAdapter {
  const client = new SignalingClient(getSignalingUrl());
  const host = new WSHost(client);
  const joiner = new WSJoiner(client);
  return {
    host,
    joiner,
    cleanup() {
      host.cleanup();
      joiner.cleanup();
      client.close();
    },
  };
}
