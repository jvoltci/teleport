'use client';

import { motion, AnimatePresence } from 'framer-motion';
import React, { useCallback, useState, DragEvent } from 'react';
import { Upload, FileIcon } from 'lucide-react';

interface DropZoneProps {
  onFileDrop: (files: File[]) => void;
  isTransferring: boolean;
}

export const DropZone = React.memo(function DropZone({ onFileDrop, isTransferring }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        setDroppedFiles(files);
        onFileDrop(files);
      }
    },
    [onFileDrop]
  );

  const handleFileSelect = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || []);
      if (files.length > 0) {
        setDroppedFiles(files);
        onFileDrop(files);
      }
    };
    input.click();
  }, [onFileDrop]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  return (
    <div className="w-full max-w-md mx-auto">
      <motion.div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={!isTransferring ? handleFileSelect : undefined}
        animate={{
          scale: 1, // Skip JS layout scaling to prevent CPU repaints
        }}
        className={`
          relative flex flex-col items-center justify-center gap-4
          w-full min-h-[200px] sm:min-h-[240px] rounded-[2rem] cursor-pointer
          backdrop-blur-[40px] transition-all duration-300
          ${isDragging
            ? 'bg-white/[0.08] shadow-[inset_0_8px_30px_rgba(0,0,0,0.6),inset_0_0_0_1px_rgba(255,255,255,0.15)] brightness-110 contrast-125'
            : 'bg-white/[0.03] shadow-[inset_0_2px_15px_rgba(0,0,0,0.5),inset_0_0_0_1px_rgba(255,255,255,0.06)] brightness-100 contrast-110 hover:bg-white/[0.05] hover:shadow-[inset_0_4px_20px_rgba(0,0,0,0.6),inset_0_0_0_1px_rgba(255,255,255,0.1)] hover:brightness-105'
          }
          ${isTransferring ? 'cursor-default pointer-events-none' : ''}
        `}
      >
        {/* Portal effect background */}
        <AnimatePresence>
          {isDragging && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              className="absolute inset-0 rounded-3xl overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-radial from-violet-500/20 via-transparent to-transparent" />
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                className="absolute inset-8 rounded-full border border-violet-500/20"
              />
              <motion.div
                animate={{ rotate: -360 }}
                transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
                className="absolute inset-16 rounded-full border border-fuchsia-500/15"
              />
            </motion.div>
          )}
        </AnimatePresence>

        <div
          className={`relative z-10 flex flex-col items-center gap-3 transition-transform duration-300 ${isDragging ? 'translate-y-[-5px] scale-105' : ''}`}
        >
          <div className="p-4 rounded-2xl bg-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_4px_10px_rgba(0,0,0,0.2)]">
            <Upload className={`w-7 h-7 transition-colors duration-300 ${isDragging ? 'text-violet-300 drop-shadow-[0_0_8px_rgba(139,92,246,0.5)]' : 'text-white/40 drop-shadow-md'}`} />
          </div>
          <div className="text-center">
            <p 
              className={`text-[15px] font-semibold tracking-wide transition-colors duration-300 ${isDragging ? 'text-violet-200' : 'text-white/50'}`}
              style={{ textShadow: '0 -1px 1px rgba(0,0,0,0.5), 0 1px 1px rgba(255,255,255,0.1)' }}
            >
              {isDragging ? 'Release to upload' : 'Drop files here'}
            </p>
            <p className="text-xs text-white/20 mt-1.5 font-medium tracking-wide">or click to browse</p>
          </div>
        </div>
      </motion.div>

      {/* Dropped files list */}
      <AnimatePresence>
        {droppedFiles.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mt-3 space-y-2"
          >
            {droppedFiles.map((file, i) => (
              <motion.div
                key={`${file.name}-${i}`}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06]"
              >
                <FileIcon className="w-4 h-4 text-violet-400 shrink-0" />
                <span className="text-sm text-white/70 truncate flex-1">{file.name}</span>
                <span className="text-xs text-white/30 shrink-0 font-mono">{formatSize(file.size)}</span>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
