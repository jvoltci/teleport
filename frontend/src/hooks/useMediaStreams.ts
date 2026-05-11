'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { addMediaTrack, removeMediaTrack } from '@/lib/webrtc';

// ─── Types ─────────────────────────────────────────────────────

export interface MediaState {
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenEnabled: boolean;
}

export interface UseMediaStreamsReturn {
  /** Current toggle states */
  mediaState: MediaState;
  /** Local camera/mic stream */
  localStream: MediaStream | null;
  /** Local screen-share stream */
  localScreenStream: MediaStream | null;
  /** Remote peer's media streams (Map of stream ID → MediaStream) */
  remoteStreams: Map<string, MediaStream>;
  /** Toggle microphone on/off */
  toggleMic: () => Promise<void>;
  /** Toggle camera on/off */
  toggleCamera: () => Promise<void>;
  /** Toggle screen share on/off */
  toggleScreen: () => Promise<void>;
  /** Handle incoming remote track (wire this to useWebRTC's onRemoteTrack) */
  handleRemoteTrack: (track: MediaStreamTrack, streams: readonly MediaStream[]) => void;
  /** End all media (stop all tracks, remove all senders) */
  endCall: () => void;
  /** Override camera front/back on mobile. Replaces track without renegotiating. */
  switchCamera: () => Promise<void>;
  /** Whether any media call is active */
  isCallActive: boolean;
  facingMode: 'user' | 'environment';
}

interface UseMediaStreamsOptions {
  peerConnection: RTCPeerConnection | null;
}

// ─── Hook ──────────────────────────────────────────────────────

export function useMediaStreams({
  peerConnection,
}: UseMediaStreamsOptions): UseMediaStreamsReturn {
  const [mediaState, setMediaState] = useState<MediaState>({
    micEnabled: false,
    cameraEnabled: false,
    screenEnabled: false,
  });

  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());

  // Track RTP senders so we can remove them later
  const sendersRef = useRef<Map<string, RTCRtpSender>>(new Map());
  // Reference to the local cam/mic stream for toggle logic
  const localStreamRef = useRef<MediaStream | null>(null);
  const localScreenStreamRef = useRef<MediaStream | null>(null);

  // ─── HELPERS ───────────────────────────────────────────────

  const disableCamera = useCallback(async () => {
    const pc = peerConnection;
    const sender = sendersRef.current.get('camera');
    if (pc && sender) {
      removeMediaTrack(pc, sender);
      sendersRef.current.delete('camera');
    }
    const stream = localStreamRef.current;
    if (stream) {
      stream.getVideoTracks().forEach((t) => {
        t.stop();
        stream.removeTrack(t);
      });
      // Do NOT create a new MediaStream, preserve native hardware anchors
    }
    setMediaState((prev) => ({ ...prev, cameraEnabled: false }));
  }, [peerConnection]);

  const disableScreen = useCallback(() => {
    const pc = peerConnection;
    if (!pc) return;
    const sender = sendersRef.current.get('screen');
    if (sender) {
      removeMediaTrack(pc, sender);
      sendersRef.current.delete('screen');
    }
    const screenAudioSender = sendersRef.current.get('screen-audio');
    if (screenAudioSender) {
      removeMediaTrack(pc, screenAudioSender);
      sendersRef.current.delete('screen-audio');
    }
    localScreenStreamRef.current?.getTracks().forEach((t) => t.stop());
    localScreenStreamRef.current = null;
    setLocalScreenStream(null);
    setMediaState((prev) => ({ ...prev, screenEnabled: false }));
  }, [peerConnection]);

  // ─── TOGGLE MICROPHONE ─────────────────────────────────────

  const toggleMic = useCallback(async () => {
    const pc = peerConnection;
    if (!pc) return;

    if (mediaState.micEnabled) {
      // Disable mic — remove the audio track
      const sender = sendersRef.current.get('mic');
      if (sender) {
        removeMediaTrack(pc, sender);
        sendersRef.current.delete('mic');
      }
      // Stop the audio track
      const stream = localStreamRef.current;
      if (stream) {
        // Completely native in-place track removal
        stream.getAudioTracks().forEach((t) => {
          t.stop();
          stream.removeTrack(t);
        });
      }
      setMediaState((prev) => ({ ...prev, micEnabled: false }));
    } else {
      // Enable mic — get audio track
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 48000,
            channelCount: 2,
          },
        });
        const audioTrack = audioStream.getAudioTracks()[0];

        // Ensure immutability for React while preserving native stream!
        let stream = localStreamRef.current;
        if (stream) {
          stream.addTrack(audioTrack);
        } else {
          localStreamRef.current = audioStream;
          setLocalStream(audioStream);
          stream = audioStream;
        }

        const sender = addMediaTrack(pc, audioTrack, stream);
        sendersRef.current.set('mic', sender);
        setMediaState((prev) => ({ ...prev, micEnabled: true }));
      } catch (e) {
        console.error('[MediaStreams] Failed to get microphone:', e);
      }
    }
  }, [peerConnection, mediaState.micEnabled]);

  // ─── TOGGLE CAMERA ─────────────────────────────────────────

  const toggleCamera = useCallback(async () => {
    const pc = peerConnection;
    if (!pc) return;

    if (mediaState.cameraEnabled) {
      disableCamera();
    } else {
      // Overriding: turn off screen if it's currently on
      if (mediaState.screenEnabled) {
        disableScreen();
      }

      // Enable camera — get video track
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: { 
            facingMode: { ideal: facingMode }, 
            frameRate: { ideal: 60 }
          },
        });
        const videoTrack = videoStream.getVideoTracks()[0];

        // Native untouched assignment guarantees secure encoder loops
        let stream = localStreamRef.current;
        if (stream) {
          stream.addTrack(videoTrack);
        } else {
          localStreamRef.current = videoStream;
          setLocalStream(videoStream);
          stream = videoStream;
        }

        const sender = addMediaTrack(pc, videoTrack, stream);

        // --- DYNAMIC BITRATE CAPPING ---
        try {
          const params = sender.getParameters();
          if (!params.encodings) {
            params.encodings = [{}];
          }
          // Cap camera bitrate to ~2.5 Mbps to reserve bandwidth for file transfers
          params.encodings[0].maxBitrate = 2500 * 1000;
          await sender.setParameters(params);
        } catch (e) {
          console.warn('[MediaStreams] Could not set camera bitrate limits:', e);
        }

        sendersRef.current.set('camera', sender);
        setMediaState((prev) => ({ ...prev, cameraEnabled: true }));
      } catch (e) {
        console.error('[MediaStreams] Failed to get camera:', e);
      }
    }
  }, [peerConnection, mediaState.cameraEnabled, mediaState.screenEnabled, disableCamera, disableScreen, facingMode]);

  // ─── SWITCH CAMERA (FRONT/BACK) ────────────────────────────

  const switchCamera = useCallback(async () => {
    const pc = peerConnection;
    if (!pc) return;
    if (!mediaState.cameraEnabled) return; // Must be on

    const nextMode = facingMode === 'user' ? 'environment' : 'user';

    try {
      // 1. Aggressively stop the old track to release mobile hardware
      const stream = localStreamRef.current;
      if (stream) {
        const oldTracks = stream.getVideoTracks();
        for (const track of oldTracks) {
          track.stop();
          stream.removeTrack(track);
        }
      }

      // 2. Try EXACT hardware mapping for guaranteed flip
      let videoStream: MediaStream;
      try {
        videoStream = await navigator.mediaDevices.getUserMedia({
          video: { 
            facingMode: { exact: nextMode }, 
            frameRate: { ideal: 60 }
          },
        });
      } catch (err) {
        // Fallback for desktops/tablets where 'exact' environment might fail
        videoStream = await navigator.mediaDevices.getUserMedia({
          video: { 
            facingMode: { ideal: nextMode }, 
            frameRate: { ideal: 60 }
          },
        });
      }

      const newVideoTrack = videoStream.getVideoTracks()[0];

      // 3. Attach seamlessly in-place to prevent camera freezing
      if (stream) {
        stream.addTrack(newVideoTrack);
      } else {
        localStreamRef.current = videoStream;
        setLocalStream(videoStream);
      }

      // Replace track on existing sender without renegotiation
      const sender = sendersRef.current.get('camera');
      if (sender) {
        await sender.replaceTrack(newVideoTrack);
      }

      setFacingMode(nextMode);
    } catch (e) {
      console.error('[MediaStreams] Complete failure to switch camera:', e);
    }
  }, [peerConnection, mediaState.cameraEnabled, facingMode]);

  // ─── TOGGLE SCREEN SHARE ───────────────────────────────────

  const toggleScreen = useCallback(async () => {
    const pc = peerConnection;
    if (!pc) return;

    if (mediaState.screenEnabled) {
      disableScreen();
    } else {
      // Overriding: turn off camera if it's currently on
      if (mediaState.cameraEnabled) {
        disableCamera();
      }

      // Start screen share
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { 
            frameRate: { ideal: 60, max: 60 }, 
            width: { ideal: 3840, max: 3840 },
            height: { ideal: 2160, max: 2160 },
            displaySurface: 'monitor',
            cursor: 'always' 
          } as MediaTrackConstraints,
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            sampleRate: 48000,
            channelCount: 2,
          },
        });

        localScreenStreamRef.current = screenStream;
        setLocalScreenStream(screenStream);

        // Add video track
        const videoTrack = screenStream.getVideoTracks()[0];
        if ('contentHint' in videoTrack) {
          videoTrack.contentHint = 'detail'; // Prioritize resolution over frame rate under network pressure
        }
        const sender = addMediaTrack(pc, videoTrack, screenStream);

        // --- DYNAMIC BITRATE CAPPING (4K) ---
        try {
          const params = sender.getParameters();
          if (!params.encodings) {
            params.encodings = [{}];
          }
          // Cap screen share bitrate to ~4 Mbps to prevent total channel saturation
          params.encodings[0].maxBitrate = 4000 * 1000;
          await sender.setParameters(params);
        } catch (e) {
          console.warn('[MediaStreams] Could not set screen bitrate limits:', e);
        }

        sendersRef.current.set('screen', sender);

        // Add audio track if present (some browsers support system audio capture)
        const audioTrack = screenStream.getAudioTracks()[0];
        if (audioTrack) {
          const audioSender = addMediaTrack(pc, audioTrack, screenStream);
          sendersRef.current.set('screen-audio', audioSender);
        }

        // Handle the user clicking "Stop sharing" in the browser's native UI
        videoTrack.onended = () => {
          console.log('[MediaStreams] Screen share ended by user');
          const s = sendersRef.current.get('screen');
          if (s && pc.signalingState !== 'closed') {
            removeMediaTrack(pc, s);
            sendersRef.current.delete('screen');
          }
          const sa = sendersRef.current.get('screen-audio');
          if (sa && pc.signalingState !== 'closed') {
            removeMediaTrack(pc, sa);
            sendersRef.current.delete('screen-audio');
          }
          localScreenStreamRef.current = null;
          setLocalScreenStream(null);
          setMediaState((prev) => ({ ...prev, screenEnabled: false }));
        };

        setMediaState((prev) => ({ ...prev, screenEnabled: true }));
      } catch (e) {
        // User cancelled the screen picker — not an error
        console.log('[MediaStreams] Screen share cancelled or failed:', e);
      }
    }
  }, [peerConnection, mediaState.screenEnabled, mediaState.cameraEnabled, disableScreen, disableCamera]);

  // ─── HANDLE INCOMING REMOTE TRACKS ─────────────────────────

  const handleRemoteTrack = useCallback(
    (track: MediaStreamTrack, streams: readonly MediaStream[]) => {
      console.log('[MediaStreams] Remote track received:', track.kind, track.id);

      setRemoteStreams((prev) => {
        const next = new Map(prev);
        for (const stream of streams) {
          // EXTREMELY CRITICAL: Pass the REAL native WebRTC stream directly to the DOM!
          // NEVER wrap remote streams in "new MediaStream()" or iOS/Chrome will permanently blackout
          // the hardware decoder pipeline. The browser inherently handles track additions if the native object remains bound.
          next.set(stream.id, stream);
        }
        if (streams.length === 0) {
          const fallbackStream = new MediaStream([track]);
          next.set(fallbackStream.id, fallbackStream);
        }
        return next;
      });

      for (const stream of streams) {
        stream.onaddtrack = () => {
          console.log('[MediaStreams] Remote track dynamically added natively');
          // Trigger React to re-evaluate without destroying the native stream identity
          setRemoteStreams((prev) => new Map(prev));
        };
        
        stream.onremovetrack = (event) => {
          console.log('[MediaStreams] Remote track removed natively:', event.track?.kind);
          setRemoteStreams((prev) => {
            const next = new Map(prev);
            const liveTracks = stream.getTracks().filter(t => t.readyState === 'live');
            if (liveTracks.length === 0) {
              next.delete(stream.id);
            } else {
              // Push the native stream identity
              next.set(stream.id, stream);
            }
            return next;
          });
        };
      }

      track.onended = () => {
        console.log('[MediaStreams] Remote track ended:', track.kind, track.id);
        setRemoteStreams((prev) => {
          const next = new Map(prev);
          for (const [id, stream] of next) {
             const tracks = stream.getTracks();
             if (tracks.some(t => t.id === track.id)) {
                 const liveTracks = tracks.filter(t => t.id !== track.id && t.readyState === 'live');
                 if (liveTracks.length === 0) {
                   next.delete(id);
                 } else {
                   next.set(id, stream);
                 }
             }
          }
          return next;
        });
      };
      
      track.onmute = () => setRemoteStreams((prev) => new Map(prev));
      track.onunmute = () => setRemoteStreams((prev) => new Map(prev));
    },
    []
  );

  // ─── END CALL ──────────────────────────────────────────────

  const endCall = useCallback(() => {
    const pc = peerConnection;

    // Remove all senders from the PC
    if (pc && pc.signalingState !== 'closed') {
      for (const sender of sendersRef.current.values()) {
        try {
          removeMediaTrack(pc, sender);
        } catch {
          // PC might already be closed
        }
      }
    }
    sendersRef.current.clear();

    // Stop all local tracks
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);

    localScreenStreamRef.current?.getTracks().forEach((t) => t.stop());
    localScreenStreamRef.current = null;
    setLocalScreenStream(null);

    // Clear and stop remote streams
    setRemoteStreams((prev) => {
      prev.forEach((stream) => stream.getTracks().forEach((t) => t.stop()));
      return new Map();
    });

    setMediaState({
      micEnabled: false,
      cameraEnabled: false,
      screenEnabled: false,
    });
  }, [peerConnection]);

  // ─── CLEANUP ON UNMOUNT ────────────────────────────────────

  useEffect(() => {
    return () => {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localScreenStreamRef.current?.getTracks().forEach((t) => t.stop());
      sendersRef.current.clear();
    };
  }, []);

  const isCallActive =
    mediaState.micEnabled || mediaState.cameraEnabled || mediaState.screenEnabled || remoteStreams.size > 0;

  return {
    mediaState,
    localStream,
    localScreenStream,
    remoteStreams,
    toggleMic,
    toggleCamera,
    toggleScreen,
    switchCamera,
    handleRemoteTrack,
    endCall,
    isCallActive,
    facingMode,
  };
}
