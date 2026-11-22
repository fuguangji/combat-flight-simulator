import type { Backend, Renderer } from './Renderer';
import { WebGL2Renderer } from './webgl2';
import { WebGPURenderer } from './webgpu';

export interface RendererHandle {
  renderer: Renderer;
  canvas: HTMLCanvasElement;
  /** Why earlier backends were skipped (useful in the status overlay and bug reports). */
  fallbackLog: string[];
}

/**
 * Tries WebGPU first, then WebGL 2. Each attempt gets a fresh canvas because a canvas can only
 * ever hold one kind of context.
 */
export async function createRenderer(container: HTMLElement, force?: Backend): Promise<RendererHandle> {
  const order: Backend[] = force === 'webgl2' ? ['webgl2'] : ['webgpu', 'webgl2'];
  const fallbackLog: string[] = [];
  for (const backend of order) {
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);
    try {
      const renderer = backend === 'webgpu' ? await WebGPURenderer.create(canvas) : await WebGL2Renderer.create(canvas);
      return { renderer, canvas, fallbackLog };
    } catch (e) {
      canvas.remove();
      fallbackLog.push(`${backend}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(`No usable renderer.\n${fallbackLog.join('\n')}`);
}
