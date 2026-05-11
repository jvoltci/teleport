'use client';

import React, { useState, useCallback, useEffect, useMemo, Suspense, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Wifi, WifiOff, RotateCcw, ScanLine } from 'lucide-react';

import { useWebRTC } from '@/hooks/useWebRTC';
import { useClipboard } from '@/hooks/useClipboard';
import { useFileTransfer } from '@/hooks/useFileTransfer';
import { useMediaStreams } from '@/hooks/useMediaStreams';
import { Portal } from '@/components/Portal';
import { CodeDisplay } from '@/components/CodeDisplay';
import { CodeInput } from '@/components/CodeInput';
import { Toast } from '@/components/Toast';
import QRDisplay from '@/components/QRDisplay';
import { FileTransferManager } from '@/components/FileTransferManager';
import dynamic from 'next/dynamic';

const QRScanner = dynamic(() => import('@/components/QRScanner'), { ssr: false });
const MediaStage = dynamic(() => import('@/components/MediaStage').then(m => m.MediaStage), { ssr: false });
const CallBar = dynamic(() => import('@/components/CallBar').then(m => m.CallBar), { ssr: false });

function RemoteAudioPlayers({ streams }: { streams: Map<string, MediaStream> }) {
  return (
    <div className="hidden">
      {Array.from(streams.values()).map((stream) => (
        <AudioPlayer key={stream.id} stream={stream} />
      ))}
    </div>
  );
}

function AudioPlayer({ stream }: { stream: MediaStream }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  
  useEffect(() => {
    if (audioRef.current && stream) {
      if (audioRef.current.srcObject !== stream) {
        audioRef.current.srcObject = stream;
      }
      audioRef.current.play().catch((e: Error | any) => console.warn('[AudioPlayer] Auto-play blocked', e));
    }
  }, [stream, stream.getTracks().length]);

  return <audio ref={audioRef} autoPlay playsInline />;
}

function TeleportInner() {
  const searchParams = useSearchParams();

  const {
    state,
    code,
    error,
    fileChannel,
    clipboardChannel,
    controlChannel,
    peerConnection,
    isPolite,
    hostSession,
    joinSession,
    disconnect,
    setOnRemoteTrack,
  } = useWebRTC();

  const {
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
  } = useMediaStreams({ peerConnection });

  // Wire up the remote track handler
  useEffect(() => {
    setOnRemoteTrack(handleRemoteTrack);
    return () => setOnRemoteTrack(null);
  }, [setOnRemoteTrack, handleRemoteTrack]);

  // ─── Identify remote streams by type ────────────────────────
  // Heuristic: screen share tracks tend to have larger dimensions
  // and are typically "video" kind. We separate them from camera streams.
  const { remoteCameraStream, remoteScreenStream } = useMemo(() => {
    let camera: MediaStream | null = null;
    let screen: MediaStream | null = null;

    for (const stream of remoteStreams.values()) {
      const videoTracks = stream.getVideoTracks();
      const hasVideo = videoTracks.length > 0;

      if (hasVideo) {
        // If we already have a camera stream, the second one is likely screen share
        if (camera) {
          screen = stream;
        } else {
          // Check track settings for clues
          const settings = videoTracks[0]?.getSettings();
          const isLikelyScreen =
            (settings?.width && settings.width > 1280) ||
            (settings?.displaySurface !== undefined);

          if (isLikelyScreen) {
            screen = stream;
          } else {
            camera = stream;
          }
        }
      } else {
        // Audio-only streams
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length > 0 && !camera) {
          camera = stream;
        }
      }
    }

    return { remoteCameraStream: camera, remoteScreenStream: screen };
  }, [remoteStreams]);

  // ─── Spatial Audio (Removed) ─────────────────────────────────
  // We no longer use spatial audio or dynamic panning.

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<'clipboard' | 'success' | 'info'>('info');
  const [showScanner, setShowScanner] = useState(false);
  const [isPortalMode, setIsPortalMode] = useState(false);

  const isConnected = state === 'connected';
  const isIdle = state === 'idle';
  const isBusy = ['creating', 'waiting', 'joining', 'connecting'].includes(state);

  // Auto-join from URL ?code=XXXX
  useEffect(() => {
    const urlCode = searchParams.get('code');
    if (urlCode && state === 'idle') {
      joinSession(urlCode.toUpperCase());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── AUTO-PORTAL SYSTEM ──────────────────────────────────────────
  // Intelligently unfold the UI when remote media streams are detected 
  // so the user never has to toggle it manually to see incoming video.
  useEffect(() => {
    if (remoteStreams.size > 0 || (state as string) === 'ringing') {
      setIsPortalMode(true);
    }
  }, [remoteStreams.size, state]);

  // Clipboard sync
  useClipboard({
    clipboardChannel,
    isConnected,
    onClipboardReceived: (text) => {
      setToastType('clipboard');
      setToastMessage(`📋 Clipboard synced: "${text.slice(0, 40)}${text.length > 40 ? '...' : ''}"`);
    },
  });

  // Micro-states removed: `useFileTransfer` and window drag/drop handlers have been decoupled 
  // and isolated entirely into <FileTransferManager /> to avoid main thread 50ms repaints.

  const handleHost = useCallback(async () => {
    await hostSession();
  }, [hostSession]);

  const handleJoin = useCallback(
    async (peerCode: string) => {
      await joinSession(peerCode);
    },
    [joinSession]
  );

  const handleQRScan = useCallback(
    (scannedCode: string) => {
      setShowScanner(false);
      handleJoin(scannedCode);
    },
    [handleJoin]
  );

  const handleEndCall = useCallback(() => {
    if (controlChannel?.readyState === 'open') {
      controlChannel.send(JSON.stringify({ type: 'ctrl-call-state', state: 'ended' }));
    }
    endCall();
  }, [endCall, controlChannel]);

  const handleDisconnect = useCallback(() => {
    if (controlChannel?.readyState === 'open') {
      controlChannel.send(JSON.stringify({ type: 'ctrl-call-state', state: 'ended' }));
    }
    endCall();
    disconnect();
  }, [endCall, disconnect, controlChannel]);

  const handleToggleScreen = useCallback(async () => {
    await toggleScreen();
  }, [toggleScreen]);

  // Listen for remote end call
  useEffect(() => {
    if (!controlChannel) return;
    const onCtrlMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'ctrl-call-state' && data.state === 'ended') {
          endCall();
        }
      } catch {}
    };
    controlChannel.addEventListener('message', onCtrlMessage);
    return () => controlChannel.removeEventListener('message', onCtrlMessage);
  }, [controlChannel, endCall]);

  return (
    <div 
      className="relative min-h-[100dvh] flex flex-col items-center justify-center px-5 py-10 overflow-hidden transform-gpu"
    >
      {/* ─── DEDICATED REMOTE AUDIO PLAYBACK ─── */}
      {isPortalMode && <RemoteAudioPlayers streams={remoteStreams} />}

      {/* ─── TACTILE FROSTED MATERIAL BACKGROUND ─── */}
      <div className="fixed inset-0 z-[-1] pointer-events-none bg-[#0a0a0a]">
        {/* CSS Ambient Mesh Light */}
        <div className={`absolute inset-0 transition-opacity duration-1000 ${isPortalMode ? 'opacity-100' : 'opacity-60'}`}>
          <div className="absolute top-[-30%] left-[-10%] w-[130vw] h-[130vh] bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-violet-900/20 via-black/0 to-transparent blur-[80px] origin-center animate-[spin_40s_linear_infinite_reverse]" style={{ transform: 'translate3d(0,0,0)' }} />
          <div className={`absolute bottom-[-30%] right-[-10%] w-[130vw] h-[130vh] bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] ${isPortalMode ? 'from-purple-900/30' : 'from-indigo-900/15'} via-black/0 to-transparent blur-[80px] origin-center animate-[spin_30s_linear_infinite]`} style={{ transform: 'translate3d(0,0,0)' }} />
        </div>
        {/* SVG Noise Grain - GPU static overlay */}
        <div 
          className="absolute inset-0 opacity-5 mix-blend-overlay"
          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}
        />
      </div>

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 flex items-center justify-between w-full max-w-5xl mb-6 px-4"
      >
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 border border-white/[0.08]">
            <Zap className="w-5 h-5 text-violet-400" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            <span className="bg-gradient-to-r from-white via-white/90 to-white/70 bg-clip-text text-transparent">
              Teleport
            </span>
          </h1>
          {isConnected && (
            <motion.span
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              className="ml-1 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider
                bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 hidden sm:inline-flex"
            >
              Connected
            </motion.span>
          )}
          {isCallActive && isConnected && (
            <motion.span
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              className="px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider
                bg-violet-500/15 text-violet-400 border border-violet-500/20 hidden sm:inline-flex"
            >
              🔴 Live
            </motion.span>
          )}
        </div>

        {/* Portal Mode Toggle */}
        <AnimatePresence>
          {isConnected && (
            <motion.button
              key="portal-toggle"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={() => {
                const nextMode = !isPortalMode;
                setIsPortalMode(nextMode);
                // Auto cleanup active media tracks if disabling Portal Mode mid-call
                if (!nextMode && isCallActive) {
                  handleEndCall();
                }
              }}
              className={`group flex items-center gap-2 px-3.5 py-1.5 rounded-full border transition-all duration-500 ${
                isPortalMode 
                  ? 'bg-purple-500/10 border-purple-500/40 shadow-[0_0_20px_rgba(192,132,252,0.25)]' 
                  : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.08]'
              }`}
            >
              <div className={`w-2 h-2 rounded-full transition-all duration-500 ${
                isPortalMode 
                  ? 'bg-purple-400 shadow-[0_0_10px_rgba(192,132,252,0.8)] animate-[pulse_2s_ease-in-out_infinite]' 
                  : 'bg-white/30 group-hover:bg-white/50'
              }`} />
              <span className={`text-[10px] font-bold uppercase tracking-[0.2em] transition-colors duration-500 ${
                isPortalMode 
                  ? 'text-purple-300' 
                  : 'text-white/40 group-hover:text-white/60'
              }`}>
                Open Portal
              </span>
            </motion.button>
          )}
        </AnimatePresence>
      </motion.div>
      {/* Portal Animation — hide when media is active to save space */}
      {!isCallActive && (
        <div className="relative z-10 mb-2">
          <Portal isActive={isConnected || isBusy} isTransferring={false} />
        </div>
      )}

      {/* ─── MEDIA STAGE (takes center stage when active) ─── */}
      <AnimatePresence>
        {isPortalMode && isConnected && isCallActive && (
          <motion.div
            key="media-stage"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 30 }}
            className="relative z-20 w-full max-w-5xl mb-6 flex-1 flex flex-col items-center justify-center max-h-[70vh]"
          >
            <MediaStage
              localStream={localStream}
              remoteCameraStream={remoteCameraStream}
              remoteScreenStream={remoteScreenStream}
              localScreenStream={localScreenStream}
              onSwitchCamera={switchCamera}
              facingMode={facingMode}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <div className={`relative z-10 w-full ${isCallActive && isConnected ? 'max-w-sm' : 'max-w-md'} px-1 transition-all duration-500`}>
        <AnimatePresence mode="wait">
          {/* ─── IDLE STATE ─────────────────────────── */}
          {isIdle && (
            <motion.div
              key="idle"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col items-center gap-7"
            >
              <motion.button
                onClick={handleHost}
                whileTap={{ scale: 0.97 }}
                className="w-full max-w-xs px-8 py-4 rounded-2xl font-semibold text-[15px]
                  bg-white/[0.03] backdrop-blur-2xl
                  shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_4px_20px_rgba(0,0,0,0.5)]
                  hover:bg-white/[0.06] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_6px_30px_rgba(0,0,0,0.6)]
                  text-white/80 transition-all duration-300"
                style={{ textShadow: '0 -1px 1px rgba(0,0,0,0.8), 0 1px 1px rgba(255,255,255,0.1)' }}
              >
                Create Session
              </motion.button>

              <div className="flex items-center gap-4 w-full max-w-xs">
                <div className="flex-1 h-px bg-white/[0.08]" />
                <span className="text-xs text-white/20 uppercase tracking-widest">or</span>
                <div className="flex-1 h-px bg-white/[0.08]" />
              </div>

              <div className="flex flex-col items-center gap-4 w-full">
                <CodeInput onJoin={handleJoin} isJoining={false} />

                {/* Scan QR button */}
                <motion.button
                  onClick={() => setShowScanner(true)}
                  whileTap={{ scale: 0.97 }}
                  className="flex items-center gap-2.5 px-6 py-2.5 rounded-xl text-sm font-medium
                    bg-white/[0.02] hover:bg-white/[0.04] text-white/50 hover:text-white
                    border border-white/[0.05] hover:border-white/10 transition-all duration-300
                    shadow-[0_2px_10px_rgba(0,0,0,0.2)]"
                >
                  <ScanLine className="w-4 h-4" />
                  Scan QR Code
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* ─── WAITING / CONNECTING STATE ──────────── */}
          {isBusy && (
            <motion.div
              key="busy"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col items-center gap-6"
            >
              {/* Code display + QR side by side */}
              <div className="flex flex-col items-center gap-5">
                <CodeDisplay code={code} state={state} />

                {state === 'waiting' && code && (
                  <QRDisplay code={code} />
                )}
              </div>

              <motion.button
                onClick={handleDisconnect}
                whileTap={{ scale: 0.97 }}
                className="flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-sm text-white/50
                  bg-white/[0.03] backdrop-blur-md border border-white/[0.05]
                  hover:bg-white/[0.06] hover:text-white hover:border-white/10
                  shadow-[0_4px_16px_rgba(0,0,0,0.2)] transition-all duration-300"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Cancel
              </motion.button>
            </motion.div>
          )}

          {/* ─── CONNECTED STATE ─────────────────────── */}
          {isConnected && (
            <motion.div
              key="connected"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col items-center gap-5"
            >
              <div className="flex items-center gap-3 px-5 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                <Wifi className="w-4 h-4 text-emerald-400/80" />
                <span className="text-sm text-white/50">
                  Session: <span className="font-mono font-semibold text-white/80">{code}</span>
                </span>
              </div>
              {/* File Transfer Subsystem */}
              <FileTransferManager
                fileChannel={fileChannel}
                controlChannel={controlChannel}
                isConnected={isConnected}
                isCallActive={isCallActive}
                onFileReceived={(fileName) => {
                  setToastType('success');
                  setToastMessage(`📦 Received: ${fileName}`);
                }}
              />

              <p className="text-[11px] text-white/20 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-500/50 animate-pulse" />
                Clipboard sync active
              </p>

              <motion.button
                onClick={handleDisconnect}
                whileTap={{ scale: 0.97 }}
                className="flex items-center gap-2.5 px-6 py-2.5 rounded-xl text-sm font-medium text-red-400
                  bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 
                  transition-all duration-300 shadow-[0_4px_15px_rgba(239,68,68,0.15)]"
              >
                <WifiOff className="w-3.5 h-3.5" />
                Disconnect
              </motion.button>
            </motion.div>
          )}

          {/* ─── DISCONNECTED / FAILED ────────────────── */}
          {(state === 'disconnected' || state === 'failed') && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col items-center gap-6"
            >
              {error && (
                <p className="text-sm text-red-400/80 text-center max-w-xs leading-relaxed">{error}</p>
              )}
              <motion.button
                onClick={handleDisconnect}
                whileTap={{ scale: 0.97 }}
                className="flex items-center gap-2.5 px-8 py-4 rounded-2xl text-[15px] font-semibold text-white/80
                  bg-white/[0.03] backdrop-blur-2xl
                  shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_4px_20px_rgba(0,0,0,0.5)]
                  hover:bg-white/[0.06] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_6px_30px_rgba(0,0,0,0.6)]
                  transition-all duration-300"
                style={{ textShadow: '0 -1px 1px rgba(0,0,0,0.8), 0 1px 1px rgba(255,255,255,0.1)' }}
              >
                <RotateCcw className="w-4 h-4" />
                Try Again
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ─── MEDIA COMPONENTS REMOVED (now inside MediaStage) ──────────────── */}

      {/* ─── CALL BAR ─────────────────────────────────────────── */}
      <AnimatePresence>
        {isPortalMode && isConnected && (
          <CallBar
            key="teleport-call-bar"
            mediaState={mediaState}
            isConnected={isConnected}
            onToggleMic={toggleMic}
            onToggleCamera={toggleCamera}
            onToggleScreen={handleToggleScreen}
            onEndCall={handleEndCall}
          />
        )}
      </AnimatePresence>

      {/* Footer */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="relative z-10 mt-10 text-[11px] text-white/15 text-center"
      >
        Peer-to-peer · Zero cloud · End-to-end encrypted
      </motion.p>

      {/* ─── MODALS & TOASTS ─── */}
      {/* Toast notifications */}
      <Toast
        message={toastMessage}
        type={toastType}
        onDismiss={() => setToastMessage(null)}
      />

      {/* QR Scanner modal */}
      {showScanner && (
        <QRScanner
          onScan={handleQRScan}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  );
}

export default function TeleportPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-white/50">Loading Teleport...</div>}>
      <TeleportInner />
    </Suspense>
  );
}
