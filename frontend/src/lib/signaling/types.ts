export interface SignalHost {
  createRoom(
    code: string,
    offer: RTCSessionDescriptionInit,
    iceCandidates: RTCIceCandidate[]
  ): Promise<void>;

  waitForAnswer(
    code: string,
    onAnswer: (
      answer: RTCSessionDescriptionInit,
      answerCandidates: RTCIceCandidateInit[]
    ) => void
  ): void;

  cleanup(): void;
}

export interface SignalJoiner {
  fetchOffer(code: string): Promise<{
    offer: RTCSessionDescriptionInit;
    offerCandidates: RTCIceCandidateInit[];
  }>;

  submitAnswer(
    code: string,
    answer: RTCSessionDescriptionInit,
    iceCandidates: RTCIceCandidate[]
  ): Promise<void>;

  cleanup(): void;
}

export interface SignalingAdapter {
  host: SignalHost;
  joiner: SignalJoiner;
  cleanup(): void;
}
