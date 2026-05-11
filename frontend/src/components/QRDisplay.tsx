'use client';

import QRCode from 'react-qr-code';
import { motion } from 'framer-motion';

interface QRDisplayProps {
  code: string;
  baseUrl?: string;
}

export default function QRDisplay({ code, baseUrl }: QRDisplayProps) {
  const joinUrl = `${baseUrl || (typeof window !== 'undefined' ? window.location.origin : '')}/teleport?code=${code}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.4 }}
      className="flex flex-col items-center gap-3"
    >
      <div className="p-3.5 rounded-[1.25rem] bg-white/90 backdrop-blur-md shadow-[0_0_20px_rgba(255,255,255,0.05)] border border-white/20">
        <div className="rounded-xl overflow-hidden">
          <QRCode
            value={joinUrl}
            size={140}
            level="M"
            bgColor="transparent"
            fgColor="#0a0a0f"
          />
        </div>
      </div>
      <p className="text-[10px] text-white/25 tracking-wide uppercase">
        Scan to connect
      </p>
    </motion.div>
  );
}
