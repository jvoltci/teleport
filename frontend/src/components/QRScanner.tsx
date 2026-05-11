'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, X, ScanLine } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface QRScannerProps {
  onScan: (code: string) => void;
  onClose: () => void;
}

export default function QRScanner({ onScan, onClose }: QRScannerProps) {
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {
        // ignore
      }
      scannerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const startScanner = async () => {
      try {
        const scanner = new Html5Qrcode('qr-reader');
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 220, height: 220 },
            aspectRatio: 1,
          },
          (decodedText) => {
            // Extract code from URL or use raw text
            try {
              const url = new URL(decodedText);
              const code = url.searchParams.get('code');
              if (code) {
                onScan(code.toUpperCase());
                return;
              }
            } catch {
              // Not a URL
            }
            // Use as a raw code if 4 letters
            if (/^[A-Za-z]{4}$/.test(decodedText)) {
              onScan(decodedText.toUpperCase());
            }
          },
          () => {
            // QR code scanning failure — ignore, keep scanning
          }
        );
      } catch (err) {
        setError('Camera access denied. Please allow camera permissions.');
        console.error('[QRScanner] Error:', err);
      }
    };

    startScanner();

    return () => {
      stopScanner();
    };
  }, [onScan, stopScanner]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      >
        <div className="relative w-[320px] rounded-2xl overflow-hidden bg-[#0a0a0f] border border-white/10 shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <div className="flex items-center gap-2 text-white/60 text-sm">
              <ScanLine className="h-4 w-4" />
              Scan QR Code
            </div>
            <button
              onClick={() => {
                stopScanner();
                onClose();
              }}
              className="p-1 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Camera viewport */}
          <div className="relative" ref={containerRef}>
            <div id="qr-reader" className="w-full" />
            {error && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0f] p-6">
                <div className="text-center">
                  <Camera className="h-10 w-10 text-white/20 mx-auto mb-3" />
                  <p className="text-sm text-red-400">{error}</p>
                  <button
                    onClick={onClose}
                    className="mt-4 px-4 py-2 rounded-lg bg-white/10 text-white/70 text-sm hover:bg-white/20 transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Footer hint */}
          <div className="px-4 py-3 text-center text-xs text-white/30 border-t border-white/5">
            Point camera at a Teleport QR code
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
