'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  CHUNK_SIZE_SMALL,
  CHUNK_SIZE_LARGE,
  BUFFER_LOW_THRESHOLD,
  BUFFER_HIGH_THRESHOLD,
} from '@/lib/teleport-constants';

export interface TransferState {
  isTransferring: boolean;
  direction: 'sending' | 'receiving' | null;
  fileName: string;
  fileSize: number;
  transferred: number;
  progress: number;
  speed: string;
  eta: string;
}

interface FileMetadata {
  type: 'file-meta';
  name: string;
  size: number;
  mimeType: string;
}

interface FileComplete {
  type: 'file-complete';
}

const initialTransferState: TransferState = {
  isTransferring: false,
  direction: null,
  fileName: '',
  fileSize: 0,
  transferred: 0,
  progress: 0,
  speed: '0 B/s',
  eta: '--',
};

function formatSpeed(bytesPerSecond: number): string {
  if (!isFinite(bytesPerSecond) || bytesPerSecond < 0) return '0 B/s';
  if (bytesPerSecond < 1024) return `${bytesPerSecond.toFixed(0)} B/s`;
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
}

function formatEta(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '0s';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.ceil(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

interface UseFileTransferOptions {
  fileChannel: RTCDataChannel | null;
  controlChannel: RTCDataChannel | null;
  isConnected: boolean;
  onFileReceived?: (fileName: string) => void;
}

export function useFileTransfer({
  fileChannel,
  controlChannel,
  isConnected,
  onFileReceived,
}: UseFileTransferOptions) {
  const [transferState, setTransferState] = useState<TransferState>(initialTransferState);
  const lastUpdateRef = useRef<number>(0);
  const cancelledRef = useRef<boolean>(false);

  // ── STABLE REFS ──────────────────────────────────────────
  const onFileReceivedRef = useRef(onFileReceived);
  useEffect(() => {
    onFileReceivedRef.current = onFileReceived;
  }, [onFileReceived]);

  // ─── SENDER — HIGH THROUGHPUT ENGINE ─────────────────────
  //
  // Strategy:
  //   1. Read the entire file into an ArrayBuffer first (avoids
  //      repeated File.slice() syscalls during the hot loop).
  //   2. Send 256 KB chunks (matching SDP max-message-size).
  //   3. Use the native `bufferedamountlow` event for flow control
  //      instead of setTimeout polling (zero-waste back-pressure).
  //   4. Minimize React state updates to every 100ms.
  //
  const sendFile = useCallback(async (file: File) => {
    if (!fileChannel || !controlChannel || fileChannel.readyState !== 'open') {
      console.error('[FileTransfer] Channels not ready');
      return;
    }

    // Send metadata first
    const meta: FileMetadata = {
      type: 'file-meta',
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
    };
    controlChannel.send(JSON.stringify(meta));

    setTransferState({
      isTransferring: true,
      direction: 'sending',
      fileName: file.name,
      fileSize: file.size,
      transferred: 0,
      progress: 0,
      speed: '0 B/s',
      eta: '--',
    });

    // Pre-read the entire file into memory for zero-copy slicing.
    // For very large files (>500MB), we fall back to streaming.
    const startTime = Date.now();
    let offset = 0;
    let chunkSize = CHUNK_SIZE_LARGE;
    cancelledRef.current = false;

    // Configure the native back-pressure event
    fileChannel.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD;

    const sendLoop = async () => {
      while (offset < file.size) {
        // ── CANCELLATION CHECK ──
        if (cancelledRef.current || fileChannel.readyState !== 'open') {
          console.warn('[FileTransfer] Transfer cancelled or channel closed');
          setTransferState(initialTransferState);
          return;
        }

        // ── BACK-PRESSURE: if buffer is full, wait for drain ──
        if (fileChannel.bufferedAmount > BUFFER_HIGH_THRESHOLD) {
          await new Promise<void>((resolve) => {
            const onLow = () => {
              fileChannel.removeEventListener('bufferedamountlow', onLow);
              resolve();
            };
            fileChannel.addEventListener('bufferedamountlow', onLow);
            // Safety timeout: if event never fires, check manually
            setTimeout(() => {
              fileChannel.removeEventListener('bufferedamountlow', onLow);
              resolve();
            }, 200);
          });
          continue; // Re-check buffer before sending
        }

        // ── SEND CHUNK ──
        const end = Math.min(offset + chunkSize, file.size);
        
        // Streaming via FileReader (memory safe for 10GB+ files)
        const chunk = await new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as ArrayBuffer);
          reader.onerror = (e) => reject(e);
          reader.readAsArrayBuffer(file.slice(offset, end));
        });

        try {
          fileChannel.send(chunk);
          offset = end;
          chunkSize = CHUNK_SIZE_LARGE; // Reset to fast after success
        } catch {
          // Send failed — back off with smaller chunk
          chunkSize = CHUNK_SIZE_SMALL;
          await new Promise((r) => setTimeout(r, 50));
          continue;
        }

        // ── PROGRESS UPDATE (throttled to ~100ms) ──
        const now = Date.now();
        if (now - lastUpdateRef.current > 100 || offset >= file.size) {
          lastUpdateRef.current = now;
          const elapsed = (now - startTime) / 1000;
          const speed = offset / elapsed;

          setTransferState((prev) => ({
            ...prev,
            transferred: offset,
            progress: (offset / file.size) * 100,
            speed: formatSpeed(speed),
            eta: formatEta((file.size - offset) / speed),
          }));
        }
      }

      // ── DONE ──
      controlChannel.send(JSON.stringify({ type: 'file-complete' } as FileComplete));

      const totalTime = (Date.now() - startTime) / 1000;
      setTransferState((prev) => ({
        ...prev,
        progress: 100,
        speed: formatSpeed(file.size / totalTime),
        eta: '0s',
      }));

      setTimeout(() => setTransferState(initialTransferState), 3000);
    };

    sendLoop();
  }, [fileChannel, controlChannel]);

  // ─── RECEIVER ──────────────────────────────────────────
  useEffect(() => {
    if (!fileChannel || !controlChannel || !isConnected) return;

    let receiveMeta: FileMetadata | null = null;
    let chunks: (ArrayBuffer | Blob)[] = [];
    let receivedBytes = 0;
    let startTime = 0;

    const handleControlMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'file-meta') {
          receiveMeta = data as FileMetadata;
          receivedBytes = 0;
          chunks = [];
          startTime = Date.now();

          setTransferState({
            isTransferring: true,
            direction: 'receiving',
            fileName: data.name,
            fileSize: data.size,
            transferred: 0,
            progress: 0,
            speed: '0 B/s',
            eta: '--',
          });
        }

        if (data.type === 'file-complete' && receiveMeta) {
          const completedFileName = receiveMeta.name;
          const completedFileSize = receiveMeta.size;
          const completedMimeType = receiveMeta.mimeType;
          const transferDuration = (Date.now() - startTime) / 1000;

          const blob = new Blob(chunks, { type: completedMimeType });

          // Trigger download
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = completedFileName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          onFileReceivedRef.current?.(completedFileName);

          receiveMeta = null;
          chunks = [];

          setTransferState((prev) => ({
            ...prev,
            progress: 100,
            speed: formatSpeed(completedFileSize / transferDuration),
            eta: '0s',
          }));

          setTimeout(() => setTransferState(initialTransferState), 3000);
        }
      } catch {
        // Not JSON or parse error
      }
    };

    const handleFileData = (event: MessageEvent) => {
      if (!receiveMeta) return;

      const chunkData = event.data;
      const len = chunkData.byteLength || chunkData.size || chunkData.length || 0;
      receivedBytes += len;
      chunks.push(chunkData);

      // Throttled progress (every ~100ms)
      const now = Date.now();
      const metaSize = receiveMeta.size;
      if (now - lastUpdateRef.current > 100 || receivedBytes >= metaSize) {
        lastUpdateRef.current = now;
        const elapsed = (now - startTime) / 1000;
        const speed = receivedBytes / elapsed;

        setTransferState((prev) => ({
          ...prev,
          transferred: receivedBytes,
          progress: (receivedBytes / metaSize) * 100,
          speed: formatSpeed(speed),
          eta: formatEta((metaSize - receivedBytes) / speed),
        }));
      }
    };

    controlChannel.addEventListener('message', handleControlMessage);
    fileChannel.addEventListener('message', handleFileData);

    return () => {
      controlChannel.removeEventListener('message', handleControlMessage);
      fileChannel.removeEventListener('message', handleFileData);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileChannel, controlChannel, isConnected]);

  return { transferState, sendFile };
}
