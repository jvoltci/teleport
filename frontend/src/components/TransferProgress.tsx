'use client';

import { motion } from 'framer-motion';

interface TransferProgressProps {
  fileName: string;
  progress: number; // 0-100
  speed: string; // e.g. "12.5 MB/s"
  eta: string; // e.g. "3s"
  direction: 'sending' | 'receiving';
}

export function TransferProgress({ fileName, progress, speed, eta, direction }: TransferProgressProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-md mx-auto"
    >
      <div className="px-5 py-5 rounded-2xl bg-white/[0.04] border border-white/[0.08]">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm text-white/60 truncate max-w-[60%] font-medium">{fileName}</span>
          <span className="text-xs text-white/35 uppercase tracking-wider font-semibold px-2.5 py-1 rounded-lg bg-white/[0.04]">
            {direction === 'sending' ? '↑ Sending' : '↓ Receiving'}
          </span>
        </div>

        {/* Progress bar */}
        <div className="relative h-2 rounded-full bg-white/[0.06] overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ ease: 'linear', duration: 0.3 }}
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-500"
          />
          {/* Shimmer effect */}
          {progress < 100 && (
            <motion.div
              animate={{ x: ['-100%', '200%'] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
              className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/20 to-transparent"
              style={{ width: `${Math.min(progress, 100)}%`, maxWidth: '33%' }}
            />
          )}
        </div>

        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-white/35 font-mono">{speed}</span>
          <span className="text-xs text-white/35 font-mono">
            {progress < 100 ? `${Math.round(progress)}% · ${eta}` : '✓ Complete!'}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
