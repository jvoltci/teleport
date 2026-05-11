'use client';

import React, { useRef, useEffect, useState } from 'react';
import { Maximize, Minimize, Video, SwitchCamera } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const AudioVisualizer = ({ stream }: { stream: MediaStream }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !stream || stream.getAudioTracks().length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    
    // Attempt real audio analysis (fails gracefully on strict browsers)
    try {
      audioCtx = new window.AudioContext();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser); // We DO NOT connect to audioCtx.destination
    } catch (e) {
      console.warn("AudioContext visualizer failed to bind to stream", e);
    }

    const dataArray = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    let animationId: number;
    let phase = 0;
    const startTime = Date.now();

    const drawSharpWave = (
      width: number,
      height: number,
      midY: number,
      colors: [string, string],
      freqMultiplier: number,
      ampMultiplier: number,
      totalAmplitude: number
    ) => {
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, colors[0] + 'CC');
      gradient.addColorStop(1, colors[1] + 'CC');

      ctx.beginPath();
      ctx.moveTo(0, midY);
      
      ctx.lineWidth = 3;
      ctx.strokeStyle = gradient;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = colors[1];
      ctx.shadowBlur = 12;

      for (let x = 0; x <= width; x += 1) {
        const distanceToCenter = Math.abs(x - (width / 2));
        const edgeDampener = Math.exp(-Math.pow(distanceToCenter / (width / 3.5), 2));

        let yOffset = Math.sin((x / width * Math.PI * 4 * freqMultiplier) + phase) * 35;
        yOffset += Math.sin((x / width * Math.PI * 12) + (phase * 2)) * 6;

        ctx.lineTo(x, midY + (yOffset * totalAmplitude * ampMultiplier * edgeDampener));
      }

      ctx.stroke();
    };

    const render = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      ctx.clearRect(0, 0, width, height);
      const midY = height / 2;
      phase += 0.05;

      let audioVolume = 0;
      if (analyser && dataArray) {
        analyser.getByteFrequencyData(dataArray);
        const sum = dataArray.reduce((acc, val) => acc + val, 0);
        audioVolume = sum / dataArray.length / 255.0; // 0 to 1
      }

      const elapsed = (Date.now() - startTime) / 1000;
      // Combine an idle breathing animation with the real audio volume
      const baseAmplitude = 0.8 + Math.sin(elapsed * 3) * 0.2;
      const totalAmplitude = baseAmplitude + (audioVolume * 2.5);

      drawSharpWave(width, height, midY, ['#00D2FF', '#38BDF8'], 1.0, 1.0, totalAmplitude);
      drawSharpWave(width, height, midY, ['#10B981', '#00FF87'], 1.8, 0.6, totalAmplitude);
      drawSharpWave(width, height, midY, ['#F43F5E', '#FF006E'], 2.5, 0.4, totalAmplitude);

      animationId = requestAnimationFrame(render);
    };

    render();
    return () => {
      cancelAnimationFrame(animationId);
      if (audioCtx && audioCtx.state !== 'closed') {
        audioCtx.close().catch(() => {});
      }
    };
  }, [stream]);

  return (
    <div className="w-full h-full flex items-center justify-center bg-black/40 backdrop-blur-3xl rounded-3xl overflow-hidden border border-white/10 shadow-[inset_0_0_100px_rgba(255,255,255,0.02)]">
      <div className="relative w-full max-w-xl h-48 flex items-center justify-center pointer-events-none">
        <canvas ref={canvasRef} className="w-full h-full" />
      </div>
    </div>
  );
};

interface MediaStageProps {
  localStream: MediaStream | null;
  remoteCameraStream: MediaStream | null;
  remoteScreenStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  onSwitchCamera?: () => Promise<void>;
  facingMode: 'user' | 'environment';
}

export const MediaStage = React.memo(function MediaStage({
  localStream,
  remoteCameraStream,
  remoteScreenStream,
  localScreenStream,
  onSwitchCamera,
  facingMode,
}: MediaStageProps) {
  const mainVideoRef = useRef<HTMLVideoElement>(null);
  const blurVideoRef = useRef<HTMLVideoElement>(null);
  const pipVideoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setIsMobile(/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
  }, []);

  // ─── DYNAMIC STAGE ROUTING ────────────────────────────────
  // Hierarchy: 1. Remote Screen, 2. Local Screen, 3. Remote Camera, 4. Local Camera
  const mainStream = remoteScreenStream || localScreenStream || remoteCameraStream || localStream;
  
  // Show PiP only if we have a local stream WITH video AND it's NOT taking up the main stage
  const hasLocalVideo = localStream && localStream.getVideoTracks().length > 0;
  const showPiP = hasLocalVideo && mainStream !== localStream;

  // Mute the main stage if it's our own local camera or local screen share to avoid audio feedback
  const isMainLocal = (mainStream === localScreenStream) || (mainStream === localStream);
  const mainTrackCount = mainStream ? mainStream.getTracks().length : 0;

  const isMainMirrored = mainStream === localStream && facingMode === 'user';
  const isPipMirrored = !!localStream && facingMode === 'user';

  useEffect(() => {
    const attachStream = (videoNode: HTMLVideoElement | null, stream: MediaStream | null) => {
      if (!videoNode) return;
      if (!stream) {
        videoNode.srcObject = null;
        return;
      }
      
      // Assign native stream directly to preserve hardware decoding bindings natively!
      if (videoNode.srcObject !== stream) {
        videoNode.srcObject = null; // force reload if it got stuck
        videoNode.srcObject = stream;
      }
      videoNode.play().catch(e => console.warn('Autoplay blocked pending interaction', e));
    };

    attachStream(mainVideoRef.current, mainStream);
    attachStream(blurVideoRef.current, mainStream);
  }, [mainStream, mainTrackCount]);

  useEffect(() => {
    if (pipVideoRef.current && localStream) {
      if (pipVideoRef.current.srcObject !== localStream) {
        pipVideoRef.current.srcObject = localStream;
      }
      pipVideoRef.current.play().catch(() => {});
    } else if (pipVideoRef.current && !localStream) {
      pipVideoRef.current.srcObject = null;
    }
  }, [localStream, showPiP]);

  // Fullscreen support
  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      await containerRef.current.requestFullscreen().catch(err => {
        console.error("Error attempting to enable fullscreen:", err);
      });
    } else {
      await document.exitFullscreen().catch(err => {
        console.error("Error attempting to disable fullscreen:", err);
      });
    }
  };

  if (!mainStream && !localStream) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -20 }}
      transition={{ type: "spring", stiffness: 200, damping: 20 }}
      ref={containerRef}
      className={`
        relative w-full aspect-[4/3] sm:aspect-video lg:aspect-[21/9] max-h-[75vh]
        flex items-center justify-center 
        bg-black/20 backdrop-blur-3xl rounded-3xl overflow-hidden 
        shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_20px_60px_rgba(0,0,0,0.5)] border border-black/40
        ${isFullscreen ? 'fixed inset-0 z-[100] rounded-none aspect-auto w-screen h-screen max-h-none' : ''}
      `}
    >
      {/* Absolute Frosted Overlay for tactile reflection */}
      {!isFullscreen && <div className="absolute inset-0 rounded-3xl ring-1 ring-inset ring-white/10 pointer-events-none z-30" />}

      {/* ─── MAIN STAGE ────────────────────────────────────────── */}
      <div className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden bg-black/60 z-0">
        
        {/* Always-mounted hardware decoders to prevent React lifecycle races */}
        <div 
          className={`absolute inset-0 transition-opacity duration-300 ease-in-out ${
            mainStream && mainStream.getVideoTracks().length > 0 ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Blurred Background Hack for ultra-premium portrait rendering */}
          <video
            ref={blurVideoRef}
            autoPlay
            playsInline
            muted
            style={{ transform: isMainMirrored ? 'translate(-50%, -50%) scaleX(-1.15) scaleY(1.15)' : 'translate(-50%, -50%) scale(1.15)' }}
            className="absolute top-1/2 left-1/2 min-w-full min-h-full object-cover blur-3xl opacity-40 saturate-200 pointer-events-none"
          />
          {/* Sharp Centered Video */}
          <video
            ref={mainVideoRef}
            autoPlay
            playsInline
            muted={isMainLocal}
            style={{ transform: isMainMirrored ? 'scaleX(-1)' : 'none' }}
            className="relative z-10 w-full h-full object-contain shadow-2xl"
          />
        </div>

        {/* Audio Visualizer securely layered above */}
        <AnimatePresence>
          {mainStream && mainStream.getVideoTracks().length === 0 && (
            <motion.div
              key="audio-visualizer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-20 flex items-center justify-center"
            >
              <AudioVisualizer stream={mainStream} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Empty state (if no main stream at all) */}
        <AnimatePresence>
          {!mainStream && (
             <motion.div 
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               className="absolute inset-0 z-10 flex flex-col items-center justify-center pointer-events-none"
             >
                <div className="w-24 h-24 mb-6 rounded-full bg-white/[0.03] border border-white/[0.05] flex items-center justify-center animate-pulse shadow-[0_0_80px_rgba(255,255,255,0.02)]">
                  <Video className="w-8 h-8 text-white/20" />
                </div>
                <p className="text-[13px] font-semibold tracking-[0.2em] text-white/30 uppercase">Waiting for Secure Link</p>
             </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ─── LOCAL PIP ─────────────────────────────────────────── */}
      <AnimatePresence>
        {showPiP && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.8, x: 20, y: 20 }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, x: 20, y: 20 }}
            transition={{ type: "spring", stiffness: 250, damping: 25 }}
            className="absolute bottom-5 right-5 sm:bottom-6 sm:right-6 w-32 sm:w-44 md:w-56 aspect-video bg-black/80 rounded-xl sm:rounded-2xl overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_10px_40px_rgba(0,0,0,0.8)] border border-black/50 z-20 transition-transform hover:scale-105"
          >
            <div className="absolute inset-0 ring-1 ring-inset ring-white/10 rounded-xl sm:rounded-2xl pointer-events-none z-20" />
            <video
              ref={pipVideoRef}
              autoPlay
              playsInline
              muted
              style={{ transform: isPipMirrored ? 'scaleX(-1)' : 'none' }}
              className="w-full h-full object-cover"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── CONTROLS (FULLSCREEN & SWITCH CAMERA) ────────────────── */}
      <div className="absolute top-5 right-5 flex flex-col gap-3 z-30">
        <motion.button
          onClick={toggleFullscreen}
          whileTap={{ scale: 0.95 }}
          className="p-2 sm:p-2.5 rounded-xl bg-white/[0.04] backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_2px_10px_rgba(0,0,0,0.5)] border border-transparent hover:border-white/10 hover:bg-white/[0.08] text-white/50 hover:text-white transition-all group"
        >
          {isFullscreen ? (
            <Minimize className="w-4 h-4 sm:w-5 sm:h-5" />
          ) : (
            <Maximize className="w-4 h-4 sm:w-5 sm:h-5" />
          )}
        </motion.button>

        {isMobile && onSwitchCamera && !!localStream && (
          <motion.button
            onClick={onSwitchCamera}
            whileTap={{ scale: 0.95 }}
            className="p-2 sm:p-2.5 rounded-xl bg-white/[0.04] backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_2px_10px_rgba(0,0,0,0.5)] border border-transparent hover:border-white/10 hover:bg-white/[0.08] text-white/50 hover:text-white transition-all group"
          >
            <SwitchCamera className="w-4 h-4 sm:w-5 sm:h-5 transition-transform group-hover:rotate-180 duration-500" />
          </motion.button>
        )}
      </div>
    </motion.div>
  );
});
