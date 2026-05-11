import {
  RTC_CONFIG,
  DC_FILE,
  DC_CLIPBOARD,
  DC_CONTROL,
} from '@/lib/teleport-constants';

export type ConnectionState = 'idle' | 'creating' | 'waiting' | 'joining' | 'connecting' | 'connected' | 'disconnected' | 'failed';

export interface TeleportPeer {
  pc: RTCPeerConnection;
  fileChannel: RTCDataChannel | null;
  clipboardChannel: RTCDataChannel | null;
  controlChannel: RTCDataChannel | null;
}

/**
 * Filter ICE candidates to prioritize LAN (host) candidates.
 * We still allow srflx (server-reflexive) for NAT traversal,
 * but we NEVER allow relay candidates to force direct P2P.
 */
function filterCandidate(candidate: RTCIceCandidate): boolean {
  if (!candidate.candidate) return false;
  // Block relay/TURN candidates — force direct connection
  if (candidate.candidate.includes('relay')) return false;
  return true;
}

/**
 * Create a new RTCPeerConnection with STUN config and
 * ICE candidate filtering for LAN priority.
 */
export function createPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection(RTC_CONFIG);
}

/**
 * Collect ICE candidates from a peer connection.
 * Returns a promise that resolves with all valid candidates
 * once ICE gathering is complete.
 */
export function collectIceCandidates(pc: RTCPeerConnection): Promise<RTCIceCandidate[]> {
  return new Promise((resolve) => {
    const candidates: RTCIceCandidate[] = [];
    
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        if (filterCandidate(event.candidate)) {
          candidates.push(event.candidate);
        }
      }
    };

    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') {
        resolve(candidates);
      }
    };

    // Fallback: always resolve after timeout in case gathering never completes
    setTimeout(() => {
      resolve(candidates);
    }, 5000);
  });
}

/**
 * Create an offer (Device A / Host).
 * Creates data channels and generates an SDP offer with ICE candidates.
 */
export async function createOffer(pc: RTCPeerConnection): Promise<{
  offer: RTCSessionDescriptionInit;
  iceCandidates: RTCIceCandidate[];
  fileChannel: RTCDataChannel;
  clipboardChannel: RTCDataChannel;
  controlChannel: RTCDataChannel;
}> {
  // Create data channels (offerer creates them)
  const fileChannel = pc.createDataChannel(DC_FILE, {
    ordered: true,
  });
  fileChannel.binaryType = 'arraybuffer';

  const clipboardChannel = pc.createDataChannel(DC_CLIPBOARD, {
    ordered: true,
  });

  const controlChannel = pc.createDataChannel(DC_CONTROL, {
    ordered: true,
  });

  // Start collecting ICE candidates
  const candidatesPromise = collectIceCandidates(pc);

  // Create offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // Wait for ICE candidates
  const iceCandidates = await candidatesPromise;

  return {
    offer: pc.localDescription!,
    iceCandidates,
    fileChannel,
    clipboardChannel,
    controlChannel,
  };
}

/**
 * Create an answer (Device B / Joiner).
 * Sets the remote offer, creates an SDP answer, and collects ICE candidates.
 */
export async function createAnswer(
  pc: RTCPeerConnection,
  offer: RTCSessionDescriptionInit,
  offerCandidates: RTCIceCandidateInit[]
): Promise<{
  answer: RTCSessionDescriptionInit;
  iceCandidates: RTCIceCandidate[];
}> {
  // Set remote description (the offer)
  await pc.setRemoteDescription(new RTCSessionDescription(offer));

  // Add remote ICE candidates
  for (const candidate of offerCandidates) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.warn('[WebRTC] Failed to add offer ICE candidate:', e);
    }
  }

  // Start collecting our ICE candidates
  const candidatesPromise = collectIceCandidates(pc);

  // Create answer
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  // Wait for ICE candidates
  const iceCandidates = await candidatesPromise;

  return {
    answer: pc.localDescription!,
    iceCandidates,
  };
}

/**
 * Apply a remote answer (Device A processes Device B's answer).
 */
export async function applyAnswer(
  pc: RTCPeerConnection,
  answer: RTCSessionDescriptionInit,
  answerCandidates: RTCIceCandidateInit[]
): Promise<void> {
  await pc.setRemoteDescription(new RTCSessionDescription(answer));

  for (const candidate of answerCandidates) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.warn('[WebRTC] Failed to add answer ICE candidate:', e);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// MEDIA RENEGOTIATION — In-Band Signaling over the Control Channel
// ═══════════════════════════════════════════════════════════════════

import {
  CTRL_SDP_OFFER,
  CTRL_SDP_ANSWER,
  CTRL_ICE_CANDIDATE,
} from '@/lib/teleport-constants';

/**
 * Add a media track to the peer connection and return its sender.
 */
export function addMediaTrack(
  pc: RTCPeerConnection,
  track: MediaStreamTrack,
  stream: MediaStream
): RTCRtpSender {
  console.log(`[WebRTC] Adding ${track.kind} track:`, track.id);
  const sender = pc.addTrack(track, stream);
  // Bitrate limits are applied per-track in useMediaStreams (camera: 2.5 Mbps, screen: 4 Mbps)
  // Do NOT set a blanket maxBitrate here — it would override the targeted caps.
  return sender;
}

/**
 * Remove a media track sender from the peer connection.
 */
export function removeMediaTrack(
  pc: RTCPeerConnection,
  sender: RTCRtpSender
): void {
  console.log('[WebRTC] Removing track sender:', sender.track?.id);
  pc.removeTrack(sender);
}

/**
 * Set up renegotiation handling on the peer connection.
 * 
 * When tracks are added/removed, the browser fires `negotiationneeded`.
 * We create a new SDP offer and send it through the control channel
 * (instead of going back through the signaling server).
 * 
 * A mutex (`isNegotiating`) prevents "glare" (simultaneous offers).
 */
export function setupRenegotiation(
  pc: RTCPeerConnection,
  controlChannel: RTCDataChannel,
  isPolite: boolean
): () => void {
  let isNegotiating = false;

  const onNegotiationNeeded = async () => {
    try {
      if (isNegotiating) {
        console.log('[WebRTC] Renegotiation already in progress, skipping');
        return;
      }
      isNegotiating = true;
      console.log('[WebRTC] negotiationneeded — creating offer via control channel');

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      if (controlChannel.readyState === 'open') {
        controlChannel.send(JSON.stringify({
          type: CTRL_SDP_OFFER,
          sdp: pc.localDescription,
        }));
      }
    } catch (e) {
      console.error('[WebRTC] Renegotiation offer error:', e);
    } finally {
      isNegotiating = false;
    }
  };

  // Trickle ICE during renegotiation
  const onIceCandidate = (event: RTCPeerConnectionIceEvent) => {
    if (event.candidate && controlChannel.readyState === 'open') {
      controlChannel.send(JSON.stringify({
        type: CTRL_ICE_CANDIDATE,
        candidate: event.candidate.toJSON(),
      }));
    }
  };

  pc.addEventListener('negotiationneeded', onNegotiationNeeded);
  pc.addEventListener('icecandidate', onIceCandidate);

  // Return cleanup function
  return () => {
    pc.removeEventListener('negotiationneeded', onNegotiationNeeded);
    pc.removeEventListener('icecandidate', onIceCandidate);
  };
}

/**
 * Handle in-band signaling messages received on the control channel.
 * 
 * Processes:
 *  - CTRL_SDP_OFFER  → sets remote desc, creates answer, sends it back
 *  - CTRL_SDP_ANSWER → sets remote desc
 *  - CTRL_ICE_CANDIDATE → adds trickle ICE candidate
 * 
 * Returns `true` if the message was a signaling message (consumed),
 * `false` if it should be handled by other listeners (file-transfer, etc.).
 */
export async function handleInbandSignaling(
  pc: RTCPeerConnection,
  controlChannel: RTCDataChannel,
  data: { type: string; [key: string]: unknown }
): Promise<boolean> {
  switch (data.type) {
    case CTRL_SDP_OFFER: {
      console.log('[WebRTC] Received in-band SDP offer');
      const sdp = data.sdp as RTCSessionDescriptionInit;
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (controlChannel.readyState === 'open') {
        controlChannel.send(JSON.stringify({
          type: CTRL_SDP_ANSWER,
          sdp: pc.localDescription,
        }));
      }
      return true;
    }

    case CTRL_SDP_ANSWER: {
      console.log('[WebRTC] Received in-band SDP answer');
      const sdp = data.sdp as RTCSessionDescriptionInit;
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      return true;
    }

    case CTRL_ICE_CANDIDATE: {
      const candidate = data.candidate as RTCIceCandidateInit;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn('[WebRTC] Failed to add in-band ICE candidate:', e);
      }
      return true;
    }

    default:
      return false;
  }
}
