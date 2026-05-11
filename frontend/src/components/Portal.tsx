'use client';

import { motion } from 'framer-motion';
import { useEffect, useRef } from 'react';

interface PortalProps {
  isActive: boolean;
  isTransferring: boolean;
}

/**
 * The central "Teleport" portal — an animated cosmic ring
 * that pulses when connected and spins during transfers.
 */
export function Portal({ isActive, isTransferring }: PortalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const size = 280;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    let animationId: number;
    let time = 0;

    const draw = () => {
      time += 0.015;
      ctx.clearRect(0, 0, size, size);

      const cx = size / 2;
      const cy = size / 2;
      const baseRadius = 90;

      // Outer glow
      if (isActive) {
        const gradient = ctx.createRadialGradient(cx, cy, baseRadius - 20, cx, cy, baseRadius + 40);
        gradient.addColorStop(0, isTransferring ? 'rgba(139, 92, 246, 0.15)' : 'rgba(139, 92, 246, 0.08)');
        gradient.addColorStop(0.5, isTransferring ? 'rgba(217, 70, 239, 0.08)' : 'rgba(217, 70, 239, 0.04)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(cx, cy, baseRadius + 40, 0, Math.PI * 2);
        ctx.fill();
      }

      // Multiple ring layers
      const rings = isActive ? 3 : 1;
      for (let r = 0; r < rings; r++) {
        const radius = baseRadius - r * 15;
        const segments = 120;
        const speed = isTransferring ? 2 : 0.5;
        const offset = r * (Math.PI / 3) + time * speed * (r % 2 === 0 ? 1 : -1);

        ctx.beginPath();
        for (let i = 0; i <= segments; i++) {
          const angle = (i / segments) * Math.PI * 2 + offset;
          const wobble = isActive
            ? Math.sin(angle * 3 + time * 2) * (isTransferring ? 4 : 2)
            : Math.sin(angle * 2 + time) * 1;
          const currentRadius = radius + wobble;
          const x = cx + Math.cos(angle) * currentRadius;
          const y = cy + Math.sin(angle) * currentRadius;

          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();

        const alpha = isActive ? 0.4 - r * 0.1 : 0.15;
        const hue = 270 + r * 30 + Math.sin(time) * 20;
        ctx.strokeStyle = `hsla(${hue}, 80%, 65%, ${alpha})`;
        ctx.lineWidth = isTransferring ? 2.5 - r * 0.5 : 1.5 - r * 0.3;
        ctx.stroke();
      }

      // Center dot
      if (isActive) {
        const dotSize = 3 + Math.sin(time * 3) * 1;
        const dotGradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, dotSize);
        dotGradient.addColorStop(0, 'rgba(139, 92, 246, 0.8)');
        dotGradient.addColorStop(1, 'rgba(139, 92, 246, 0)');
        ctx.fillStyle = dotGradient;
        ctx.beginPath();
        ctx.arc(cx, cy, dotSize, 0, Math.PI * 2);
        ctx.fill();
      }

      // Orbiting particles during transfer
      if (isTransferring) {
        for (let p = 0; p < 8; p++) {
          const angle = (p / 8) * Math.PI * 2 + time * 3;
          const dist = baseRadius - 5 + Math.sin(time * 4 + p) * 10;
          const x = cx + Math.cos(angle) * dist;
          const y = cy + Math.sin(angle) * dist;
          const particleSize = 2 + Math.sin(time * 5 + p * 2) * 1;

          ctx.fillStyle = `hsla(${280 + p * 15}, 80%, 70%, ${0.6 + Math.sin(time * 3 + p) * 0.3})`;
          ctx.beginPath();
          ctx.arc(x, y, particleSize, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      animationId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animationId);
  }, [isActive, isTransferring]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 200, damping: 20 }}
      className="relative flex items-center justify-center"
    >
      <canvas
        ref={canvasRef}
        className="pointer-events-none"
      />
    </motion.div>
  );
}
