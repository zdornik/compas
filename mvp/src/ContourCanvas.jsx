import { useEffect, useRef } from 'react';
import { contourPalette } from './mood-motion.js';

// Recolour the actual generated contour texture, keeping its geometry and
// sculptural shading. A single continuous mood coordinate visits every palette
// between the old and new state, even when the slider jumps from end to end.
export function ContourCanvas({ value, src = '/art/contours-v2.webp', tracking = false, style, onReady }) {
  const canvas = useRef(null);
  const texture = useRef(null);
  const position = useRef(value);
  const target = useRef(value);
  const frame = useRef(0);
  const direct = useRef(tracking);
  const mounted = useRef(false);
  const reduced = useRef(false);
  const animate = useRef(null);

  useEffect(() => {
    mounted.current = true;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduced.current = media.matches;
    const context = canvas.current.getContext('2d');
    let width, height;
    const image = new Image();
    let pixels;
    const palette = new Uint8ClampedArray(256 * 3);
    const render = coordinate => {
      if (!texture.current || !mounted.current) return;
      const { inner, outer } = contourPalette(coordinate);
      for (let level = 0; level < 256; level++) {
        const mix = level / 255;
        for (let channel = 0; channel < 3; channel++) palette[level * 3 + channel] = inner[channel] + (outer[channel] - inner[channel]) * mix;
      }
      const data = pixels.data, shades = texture.current;
      for (let index = 0, pixel = 0; index < data.length; index += 4, pixel++) {
        const lookup = shades[pixel] * 3;
        data[index] = palette[lookup]; data[index + 1] = palette[lookup + 1]; data[index + 2] = palette[lookup + 2]; data[index + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);
    };
    animate.current = () => {
      if (!texture.current || frame.current) return;
      let previous = performance.now();
      const tick = now => {
        frame.current = 0;
        if (!mounted.current) return;
        const elapsed = Math.min(50, Math.max(1, now - previous));
        previous = now;
        if (direct.current || reduced.current) position.current = target.current;
        else position.current += (target.current - position.current) * (1 - Math.exp(-elapsed / 70));
        if (Math.abs(target.current - position.current) < .001) position.current = target.current;
        render(position.current);
        if (position.current !== target.current) frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    };
    const motionChange = event => { reduced.current = event.matches; animate.current?.(); };
    media.addEventListener('change', motionChange);
    image.onload = () => {
      if (!mounted.current) return;
      // Never reduce the source to a thumbnail before stretching it across the
      // sheet. Native pixels retain clean edges without adding extra relief.
      width = image.naturalWidth; height = image.naturalHeight;
      canvas.current.width = width; canvas.current.height = height;
      pixels = context.createImageData(width, height);
      context.drawImage(image, 0, 0, width, height);
      const original = context.getImageData(0, 0, width, height).data;
      const shades = new Uint8Array(width * height);
      for (let i = 0, p = 0; i < original.length; i += 4, p++) {
        const luminance = original[i] * .2126 + original[i + 1] * .7152 + original[i + 2] * .0722;
        shades[p] = Math.max(0, Math.min(255, (luminance - 91) / (233 - 91) * 255));
      }
      texture.current = shades;
      position.current = target.current;
      render(position.current);
      onReady?.(true);
    };
    image.src = src;
    return () => { mounted.current = false; image.onload = null; cancelAnimationFrame(frame.current); frame.current = 0; media.removeEventListener('change', motionChange); texture.current = null; };
  }, [src, onReady]);

  useEffect(() => { target.current = value; direct.current = tracking; animate.current?.(); }, [value, tracking]);
  return <canvas ref={canvas} style={style} className="scene-contours" aria-hidden="true"/>;
}
