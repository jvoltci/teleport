'use client';

import { motion } from 'framer-motion';
import { ArrowRight, Loader2 } from 'lucide-react';
import React, { useState, useCallback, KeyboardEvent } from 'react';

interface CodeInputProps {
  onJoin: (code: string) => void;
  isJoining: boolean;
}

export const CodeInput = React.memo(function CodeInput({ onJoin, isJoining }: CodeInputProps) {
  const [value, setValue] = useState('');

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim().toUpperCase();
    if (trimmed.length >= 3 && !isJoining) {
      onJoin(trimmed);
    }
  }, [value, onJoin, isJoining]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="flex flex-col items-center gap-3 w-full max-w-xs"
    >
      <p className="text-xs font-semibold text-white/30 uppercase tracking-[0.25em]">
        Enter a code
      </p>
      <div className="relative flex items-center w-full">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value.toUpperCase().slice(0, 6))}
          onKeyDown={handleKeyDown}
          placeholder="CODE"
          maxLength={6}
          disabled={isJoining}
          className="w-full px-6 py-4 rounded-2xl text-center text-xl font-mono font-bold tracking-[0.4em]
            bg-white/[0.04] backdrop-blur-3xl shadow-[inset_0_2px_15px_rgba(0,0,0,0.5),inset_0_0_0_1px_rgba(255,255,255,0.06)] 
            text-white placeholder:text-white/20
            focus:outline-none focus:shadow-[inset_0_4px_20px_rgba(0,0,0,0.6),inset_0_0_0_1px_rgba(255,255,255,0.2)] 
            disabled:opacity-50 transition-all duration-300"
          style={{ textShadow: '0 -1px 1px rgba(0,0,0,0.5), 0 1px 1px rgba(255,255,255,0.1)' }}
        />
        <motion.button
          onClick={handleSubmit}
          disabled={value.trim().length < 3 || isJoining}
          whileTap={{ scale: 0.95 }}
          className="absolute right-3 p-2.5 rounded-xl
            bg-white/[0.08] backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_2px_10px_rgba(0,0,0,0.3)]
            text-white hover:bg-white/[0.12] disabled:opacity-30 disabled:cursor-not-allowed
            border border-transparent hover:border-white/10
            transition-all duration-300"
        >
          {isJoining ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <ArrowRight className="w-5 h-5" />
          )}
        </motion.button>
      </div>
    </motion.div>
  );
});
