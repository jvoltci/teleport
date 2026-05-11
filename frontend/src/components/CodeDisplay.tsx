"use client";

import { motion } from "framer-motion";
import { Copy, Check } from "lucide-react";
import { useState, useCallback } from "react";

interface CodeDisplayProps {
  code: string;
  state: string;
}

export function CodeDisplay({ code, state }: CodeDisplayProps) {
  const [copied, setCopied] = useState(false);

  const copyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may fail without user gesture
    }
  }, [code]);

  const statusText =
    {
      creating: "Generating...",
      waiting: "Waiting for peer...",
      connecting: "Connecting...",
      connected: "Connected!",
    }[state] || "";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center gap-4"
    >
      <p className="text-sm font-medium text-white/40 uppercase tracking-[0.3em]">
        Your Code
      </p>
      <motion.button
        onClick={copyCode}
        whileTap={{ scale: 0.97 }}
        className="group relative flex items-center justify-center px-4 sm:px-8 py-4 sm:py-5 rounded-2xl
          bg-white/[0.04] backdrop-blur-2xl
          shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_8px_30px_rgba(0,0,0,0.6)]
          hover:bg-white/[0.06] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_12px_40px_rgba(0,0,0,0.8)]
          transition-all duration-300 w-full overflow-hidden"
      >
        <span
          className="text-[2.5rem] sm:text-6xl font-mono font-bold tracking-[0.1em] sm:tracking-[0.4em] text-white/90 whitespace-nowrap inline-block"
          style={{
            textShadow:
              "0 -2px 3px rgba(0,0,0,0.8), 0 1px 2px rgba(255,255,255,0.2)",
          }}
        >
          {code || "····"}
        </span>
        <span className="absolute right-3 top-3 sm:right-4 sm:top-4 p-2 rounded-lg bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-md">
          {copied ? (
            <Check className="w-4 h-4 text-emerald-400 drop-shadow-[0_0_5px_rgba(52,211,153,0.5)]" />
          ) : (
            <Copy className="w-4 h-4 text-white/70 drop-shadow-[0_0_5px_rgba(255,255,255,0.2)]" />
          )}
        </span>
      </motion.button>
      {statusText && (
        <motion.p
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-sm text-white/30 flex items-center gap-2"
        >
          {state === "waiting" && (
            <div className="relative flex items-center justify-center w-2 h-2 mr-2">
              <style>{`
                @keyframes sonarRipple {
                  0% { transform: scale(1); opacity: 0.5; }
                  100% { transform: scale(4); opacity: 0; }
                }
              `}</style>
              <div
                className="absolute w-full h-full rounded-full bg-violet-400"
                style={{
                  animation:
                    "sonarRipple 2s cubic-bezier(0, 0, 0.2, 1) infinite",
                }}
              />
              <div className="relative rounded-full h-2 w-2 bg-violet-400/80 shadow-[0_0_5px_rgba(139,92,246,0.8)]" />
            </div>
          )}
          {statusText}
        </motion.p>
      )}
    </motion.div>
  );
}
