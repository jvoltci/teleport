/**
 * Teleport – Configuration Constants
 *
 * Tuned for high throughput while staying within safe WebRTC limits.
 * STUN / TURN servers are configurable via NEXT_PUBLIC_* env vars.
 */

function buildIceServers(): RTCIceServer[] {
  const stunEnv = process.env.NEXT_PUBLIC_STUN_URLS;
  const stunList = stunEnv
    ? stunEnv.split(",").map((u) => u.trim()).filter(Boolean)
    : [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
        "stun:stun2.l.google.com:19302",
      ];

  const servers: RTCIceServer[] = stunList.map((urls) => ({ urls }));

  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
  const turnUser = process.env.NEXT_PUBLIC_TURN_USERNAME;
  const turnCred = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: turnUser || undefined,
      credential: turnCred || undefined,
    });
  }

  return servers;
}

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: buildIceServers(),
  iceCandidatePoolSize: 4,
};

// File transfer tuning (see ARCHITECTURE.md § File transfer pipeline)
export const CHUNK_SIZE_LARGE = 256 * 1024;
export const CHUNK_SIZE_SMALL = 64 * 1024;
export const BUFFER_HIGH_THRESHOLD = 1 * 1024 * 1024;
export const BUFFER_LOW_THRESHOLD = 256 * 1024;

// Data Channel Labels
export const DC_FILE = "file-transfer";
export const DC_CLIPBOARD = "clipboard-sync";
export const DC_CONTROL = "control";

// Control-channel message types (in-band SDP renegotiation)
export const CTRL_SDP_OFFER = "ctrl-sdp-offer";
export const CTRL_SDP_ANSWER = "ctrl-sdp-answer";
export const CTRL_ICE_CANDIDATE = "ctrl-ice-candidate";
export const CTRL_LASER_POINTER = "ctrl-laser-pointer";
export const CTRL_CALL_STATE = "ctrl-call-state";
