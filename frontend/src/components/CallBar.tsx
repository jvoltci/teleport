'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Mic, MicOff, Camera, CameraOff, Monitor, MonitorOff, PhoneOff } from 'lucide-react';
import type { MediaState } from '../_hooks/useMediaStreams';

interface CallBarProps {
  mediaState: MediaState;
  isConnected: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleScreen: () => void;
  onEndCall: () => void;
}

export function CallBar({
  mediaState,
  isConnected,
  onToggleMic,
  onToggleCamera,
  onToggleScreen,
  onEndCall,
}: CallBarProps) {
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setIsMobile(/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
    setMounted(true);
  }, []);

  if (!isConnected || !mounted) return null;

  const buttons = [
    {
      key: 'mic',
      active: mediaState.micEnabled,
      Icon: mediaState.micEnabled ? Mic : MicOff,
      onClick: onToggleMic,
      label: mediaState.micEnabled ? 'Mute' : 'Unmute',
    },
    {
      key: 'camera',
      active: mediaState.cameraEnabled,
      Icon: mediaState.cameraEnabled ? Camera : CameraOff,
      onClick: onToggleCamera,
      label: mediaState.cameraEnabled ? 'Stop Camera' : 'Start Camera',
    },
    ...(isMobile ? [] : [{
      key: 'screen',
      active: mediaState.screenEnabled,
      Icon: mediaState.screenEnabled ? Monitor : MonitorOff,
      onClick: onToggleScreen,
      label: mediaState.screenEnabled ? 'Stop Sharing' : 'Share Screen',
    }]),
  ];

  return createPortal(
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      className="
        fixed bottom-6 left-1/2 -translate-x-1/2 z-[60]
        flex items-center gap-3
        px-4 sm:px-5 py-3 rounded-2xl
        bg-black/40 backdrop-blur-2xl
        border border-white/10
        shadow-[0_8px_30px_rgba(0,0,0,0.6)]
      "
    >
      {buttons.map(({ key, active, Icon, onClick, label }) => (
        <motion.button
          key={key}
          onClick={onClick}
          whileTap={{ scale: 0.95 }}
          title={label}
          className={`
            relative p-3 rounded-xl transition-all duration-300
            ${active 
              ? 'bg-black/50 shadow-[inset_0_4px_12px_rgba(0,0,0,0.9),inset_0_1px_2px_rgba(0,0,0,0.8)] border-t border-black/80' 
              : 'bg-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_2px_8px_rgba(0,0,0,0.5)] border border-white/[0.03] hover:bg-white/[0.08] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_4px_12px_rgba(0,0,0,0.6)]'
            }
          `}
        >
          <Icon className={`w-5 h-5 transition-colors duration-300 ${active ? 'text-violet-400 drop-shadow-[0_0_8px_rgba(139,92,246,0.6)]' : 'text-white/50'}`} />
          {active && (
            <motion.div
              layoutId={`callbar-active-${key}`}
              className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-white/60"
            />
          )}
        </motion.button>
      ))}

      {/* Divider */}
      <div className="w-px h-8 bg-white/[0.08] mx-1" />

      {/* End Call button */}
      <motion.button
        onClick={onEndCall}
        whileTap={{ scale: 0.95 }}
        title="End Call"
        className="
          p-3 rounded-xl
          bg-red-500/20 backdrop-blur-md
          shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_4px_15px_rgba(0,0,0,0.4)]
          border border-red-500/30
          hover:bg-red-500/30 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_6px_20px_rgba(239,68,68,0.3)]
          transition-all duration-300
        "
      >
        <PhoneOff className="w-5 h-5 text-red-400" />
      </motion.button>
    </motion.div>,
    document.body
  );
}
