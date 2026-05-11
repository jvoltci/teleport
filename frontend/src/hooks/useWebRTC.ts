'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  createPeerConnection,
  createOffer,
  createAnswer,
  applyAnswer,
  setupRenegotiation,
  handleInbandSignaling,
  ConnectionState,
} from '@/lib/webrtc';
import { generateCode } from '@/lib/words';
import { createSignalingAdapter, type SignalingAdapter } from '@/lib/signaling';

// ─── Types ─────────────────────────────────────────────────────

export type RemoteTrackHandler = (
  track: MediaStreamTrack,
  streams: readonly MediaStream[]
) => void;

interface UseWebRTCReturn {
  state: ConnectionState;
  code: string;
  error: string | null;
  fileChannel: RTCDataChannel | null;
  clipboardChannel: RTCDataChannel | null;
  controlChannel: RTCDataChannel | null;
  /** Expose the raw RTCPeerConnection so useMediaStreams can addTrack/removeTrack. */
  peerConnection: RTCPeerConnection | null;
  /** Whether this peer is the "polite" side (joiner). Used for glare resolution. */
  isPolite: boolean;
  hostSession: () => Promise<void>;
  joinSession: (peerCode: string) => Promise<void>;
  disconnect: () => void;
  /** Register a handler that fires when the remote peer adds a media track. */
  setOnRemoteTrack: (handler: RemoteTrackHandler | null) => void;
}

export function useWebRTC(): UseWebRTCReturn {
  const [state, setState] = useState<ConnectionState>('idle');
  const [code, setCode] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [fileChannel, setFileChannel] = useState<RTCDataChannel | null>(null);
  const [clipboardChannel, setClipboardChannel] = useState<RTCDataChannel | null>(null);
  const [controlChannel, setControlChannel] = useState<RTCDataChannel | null>(null);
  const [peerConnection, setPeerConnection] = useState<RTCPeerConnection | null>(null);
  const [isPolite, setIsPolite] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const adapterRef = useRef<SignalingAdapter | null>(null);
  const renegotiationCleanupRef = useRef<(() => void) | null>(null);
  const onRemoteTrackRef = useRef<RemoteTrackHandler | null>(null);

  const setOnRemoteTrack = useCallback((handler: RemoteTrackHandler | null) => {
    onRemoteTrackRef.current = handler;
  }, []);

  const cleanupAdapter = useCallback(() => {
    adapterRef.current?.cleanup();
    adapterRef.current = null;
  }, []);

  const setupConnectionMonitor = useCallback((pc: RTCPeerConnection) => {
    pc.onconnectionstatechange = () => {
      console.log('[WebRTC] Connection state:', pc.connectionState);
      switch (pc.connectionState) {
        case 'connected':
          setState('connected');
          break;
        case 'disconnected':
          setState('disconnected');
          break;
        case 'failed':
          setState('failed');
          setError('Connection failed. Please try again.');
          break;
        case 'closed':
          setState('disconnected');
          break;
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[WebRTC] ICE Connection state:', pc.iceConnectionState);
      switch (pc.iceConnectionState) {
        case 'disconnected':
          // Transient — WebRTC may recover automatically. Don't nuke the session.
          console.warn('[WebRTC] ICE temporarily disconnected, waiting for recovery...');
          break;
        case 'failed':
          // Terminal — ICE cannot recover. Notify the user.
          setState('failed');
          setError('Network connection lost. The peer may have dropped.');
          break;
      }
    };
  }, []);

  /**
   * Set up the `ontrack` handler on the peer connection.
   * This fires when the remote peer adds a media track (camera, mic, screen).
   */
  const setupOnTrack = useCallback((pc: RTCPeerConnection) => {
    pc.ontrack = (event: RTCTrackEvent) => {
      console.log('[WebRTC] Remote track received:', event.track.kind, event.track.id);
      onRemoteTrackRef.current?.(event.track, event.streams);
    };
  }, []);

  /**
   * Set up in-band signaling: listen on the control channel for SDP/ICE messages
   * and route them through the renegotiation pipeline.
   */
  const setupInbandSignaling = useCallback(
    (pc: RTCPeerConnection, ctrlChannel: RTCDataChannel, polite: boolean) => {
      // Set up renegotiation (handles negotiationneeded → sends offer via ctrl channel)
      renegotiationCleanupRef.current = setupRenegotiation(pc, ctrlChannel, polite);

      // Listen for incoming signaling messages on the control channel
      const onMessage = async (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          // Try to handle as signaling; if false, it's a file-transfer message
          await handleInbandSignaling(pc, ctrlChannel, data);
        } catch {
          // Not JSON or not a signaling message — ignore (other listeners handle it)
        }
      };

      ctrlChannel.addEventListener('message', onMessage);

      // Store cleanup in case we need to remove later
      const prevCleanup = renegotiationCleanupRef.current;
      renegotiationCleanupRef.current = () => {
        prevCleanup?.();
        ctrlChannel.removeEventListener('message', onMessage);
      };
    },
    []
  );

  /**
   * HOST a session (Device A).
   * Generates code → creates offer → signals via adapter → waits for answer.
   * The host is the "impolite" peer (isPolite = false).
   */
  const hostSession = useCallback(async () => {
    try {
      setState('creating');
      setError(null);
      setIsPolite(false);

      const adapter = createSignalingAdapter();
      adapterRef.current = adapter;

      const sessionCode = generateCode();
      setCode(sessionCode);

      const pc = createPeerConnection();
      pcRef.current = pc;
      setPeerConnection(pc);
      setupConnectionMonitor(pc);
      setupOnTrack(pc);

      const {
        offer,
        iceCandidates,
        fileChannel: fc,
        clipboardChannel: cc,
        controlChannel: ctc,
      } = await createOffer(pc);

      setFileChannel(fc);
      setClipboardChannel(cc);
      setControlChannel(ctc);

      // Wire up in-band signaling once control channel is open
      ctc.onopen = () => {
        setupInbandSignaling(pc, ctc, false);
      };
      // If already open (unlikely but safe)
      if (ctc.readyState === 'open') {
        setupInbandSignaling(pc, ctc, false);
      }

      // Push offer via adapter (works for both KV and WS)
      await adapter.host.createRoom(sessionCode, offer, iceCandidates);

      // Wait for answer via adapter
      setState('waiting');
      adapter.host.waitForAnswer(sessionCode, async (answer, answerCandidates) => {
        try {
          setState('connecting');
          await applyAnswer(pc, answer, answerCandidates);
        } catch (e) {
          console.error('[WebRTC] Apply answer error:', e);
          setState('failed');
          setError('Failed to establish connection.');
        }
      });
    } catch (e) {
      console.error('[WebRTC] Host error:', e);
      setState('failed');
      setError(e instanceof Error ? e.message : 'Failed to create session');
    }
  }, [setupConnectionMonitor, setupOnTrack, setupInbandSignaling, cleanupAdapter]);

  /**
   * JOIN a session (Device B).
   * Fetches offer via adapter → creates answer → submits answer via adapter.
   * The joiner is the "polite" peer (isPolite = true).
   */
  const joinSession = useCallback(async (peerCode: string) => {
    try {
      setState('joining');
      setError(null);
      setIsPolite(true);
      const upperCode = peerCode.toUpperCase();
      setCode(upperCode);

      const adapter = createSignalingAdapter();
      adapterRef.current = adapter;

      const pc = createPeerConnection();
      pcRef.current = pc;
      setPeerConnection(pc);
      setupConnectionMonitor(pc);
      setupOnTrack(pc);

      // Listen for data channels from host
      pc.ondatachannel = (event) => {
        const channel = event.channel;
        console.log('[WebRTC] Received data channel:', channel.label);
        switch (channel.label) {
          case 'file-transfer':
            channel.binaryType = 'arraybuffer';
            setFileChannel(channel);
            break;
          case 'clipboard-sync':
            setClipboardChannel(channel);
            break;
          case 'control':
            setControlChannel(channel);
            // Wire up in-band signaling as soon as the control channel arrives
            channel.onopen = () => {
              setupInbandSignaling(pc, channel, true);
            };
            if (channel.readyState === 'open') {
              setupInbandSignaling(pc, channel, true);
            }
            break;
        }
      };

      // Fetch offer via adapter
      const { offer, offerCandidates } = await adapter.joiner.fetchOffer(upperCode);

      // Create answer
      setState('connecting');
      const { answer, iceCandidates } = await createAnswer(
        pc,
        offer,
        offerCandidates
      );

      // Submit answer via adapter
      await adapter.joiner.submitAnswer(upperCode, answer, iceCandidates);
    } catch (e) {
      console.error('[WebRTC] Join error:', e);
      setState('failed');
      setError(e instanceof Error ? e.message : 'Failed to join session');
    }
  }, [setupConnectionMonitor, setupOnTrack, setupInbandSignaling, cleanupAdapter]);


  const disconnect = useCallback(() => {
    cleanupAdapter();
    renegotiationCleanupRef.current?.();
    renegotiationCleanupRef.current = null;
    fileChannel?.close();
    clipboardChannel?.close();
    controlChannel?.close();
    pcRef.current?.close();
    pcRef.current = null;
    setPeerConnection(null);
    setFileChannel(null);
    setClipboardChannel(null);
    setControlChannel(null);
    setState('idle');
    setCode('');
    setError(null);
    setIsPolite(false);
  }, [fileChannel, clipboardChannel, controlChannel, cleanupAdapter]);

  useEffect(() => {
    return () => {
      cleanupAdapter();
      renegotiationCleanupRef.current?.();
      pcRef.current?.close();
    };
  }, [cleanupAdapter]);

  return {
    state, code, error,
    fileChannel, clipboardChannel, controlChannel,
    peerConnection, isPolite,
    hostSession, joinSession, disconnect,
    setOnRemoteTrack,
  };
}
