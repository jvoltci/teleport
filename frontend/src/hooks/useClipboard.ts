'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

interface UseClipboardOptions {
  clipboardChannel: RTCDataChannel | null;
  isConnected: boolean;
  onClipboardReceived?: (text: string) => void;
}

export function useClipboard({ clipboardChannel, isConnected, onClipboardReceived }: UseClipboardOptions) {
  const lastClipboardRef = useRef<string>('');
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  // Send clipboard text over data channel
  const sendClipboard = useCallback((text: string) => {
    if (clipboardChannel && clipboardChannel.readyState === 'open' && text !== lastClipboardRef.current) {
      lastClipboardRef.current = text;
      clipboardChannel.send(JSON.stringify({ type: 'clipboard', text, ts: Date.now() }));
      setLastSynced(text);
    }
  }, [clipboardChannel]);

  // Listen for incoming clipboard
  useEffect(() => {
    if (!clipboardChannel || !isConnected) return;

    const handleMessage = async (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'clipboard' && data.text) {
          lastClipboardRef.current = data.text;
          // Write to system clipboard
          try {
            await navigator.clipboard.writeText(data.text);
            setLastSynced(data.text);
            onClipboardReceived?.(data.text);
          } catch {
            // Clipboard write may fail without user gesture
            console.warn('[Clipboard] Cannot write to clipboard without user gesture');
            onClipboardReceived?.(data.text);
          }
        }
      } catch {
        // Not JSON, ignore
      }
    };

    clipboardChannel.addEventListener('message', handleMessage);
    return () => clipboardChannel.removeEventListener('message', handleMessage);
  }, [clipboardChannel, isConnected, onClipboardReceived]);

  // Monitor clipboard on window focus
  useEffect(() => {
    if (!isConnected || !clipboardChannel) return;

    const handleFocus = async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text && text !== lastClipboardRef.current && text.length < 50000) {
          sendClipboard(text);
        }
      } catch {
        // Clipboard read requires permission / user gesture
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [isConnected, clipboardChannel, sendClipboard]);

  return { lastSynced, sendClipboard };
}
