'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Clipboard, X } from 'lucide-react';
import { useEffect, useState } from 'react';

interface ToastProps {
  message: string | null;
  type?: 'clipboard' | 'success' | 'info';
  onDismiss: () => void;
}

export function Toast({ message, type = 'info', onDismiss }: ToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (message) {
      setVisible(true);
      const timer = setTimeout(() => {
        setVisible(false);
        setTimeout(onDismiss, 300);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [message, onDismiss]);

  const icons = {
    clipboard: <Clipboard className="w-4 h-4 text-cyan-400" />,
    success: <CheckCircle2 className="w-4 h-4 text-emerald-400" />,
    info: <CheckCircle2 className="w-4 h-4 text-violet-400" />,
  };

  return (
    <AnimatePresence>
      {visible && message && (
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
        >
          <div className="flex items-center gap-3 px-5 py-3 rounded-2xl
            bg-white/[0.08] border border-white/[0.1] backdrop-blur-2xl
            shadow-2xl shadow-black/40"
          >
            {icons[type]}
            <span className="text-sm text-white/80 max-w-64 truncate">{message}</span>
            <button
              onClick={() => { setVisible(false); onDismiss(); }}
              className="p-1 rounded-lg hover:bg-white/10 transition-colors"
            >
              <X className="w-3 h-3 text-white/40" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
