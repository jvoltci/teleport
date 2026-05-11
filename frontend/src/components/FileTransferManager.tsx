'use client';

import React, { memo, useCallback, useEffect } from 'react';
import { DropZone } from './DropZone';
import { TransferProgress } from './TransferProgress';
import { useFileTransfer } from '../_hooks/useFileTransfer';

interface FileTransferManagerProps {
  fileChannel: RTCDataChannel | null;
  controlChannel: RTCDataChannel | null;
  isConnected: boolean;
  onFileReceived: (fileName: string) => void;
  isCallActive: boolean;
}

export const FileTransferManager = memo(function FileTransferManager({
  fileChannel,
  controlChannel,
  isConnected,
  onFileReceived,
  isCallActive
}: FileTransferManagerProps) {
  
  const { transferState, sendFile } = useFileTransfer({
    fileChannel,
    controlChannel,
    isConnected,
    onFileReceived,
  });

  const handleFileDrop = useCallback(
    (files: File[]) => {
      if (files.length > 0 && isConnected) {
        sendFile(files[0]);
      }
    },
    [isConnected, sendFile]
  );

  useEffect(() => {
    const handleWindowDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleWindowDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length > 0 && isConnected) {
        sendFile(files[0]);
      }
    };

    if (isConnected) {
      window.addEventListener('dragover', handleWindowDragOver);
      window.addEventListener('drop', handleWindowDrop);
    }

    return () => {
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('drop', handleWindowDrop);
    };
  }, [isConnected, sendFile]);

  return (
    <>
      {!isCallActive && (
        <DropZone onFileDrop={handleFileDrop} isTransferring={transferState.isTransferring} />
      )}

      {/* Only show progress if transferring, or keep it available below MediaStage */}
      {transferState.isTransferring && (
        <TransferProgress
          fileName={transferState.fileName}
          progress={transferState.progress}
          speed={transferState.speed}
          eta={transferState.eta}
          direction={transferState.direction!}
        />
      )}
    </>
  );
});
