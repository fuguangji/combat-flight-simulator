/**
 * Per-aircraft cockpit panel looks. Everything here is invented for this game: colours, layouts and
 * nameplates describe the fictional aircraft in `src/aircraft/data`, not any real cockpit.
 */
export type PanelLayout = 'wide' | 'twin' | 'stack' | 'compact';
export type CanopyStyle = 'bubble' | 'framed' | 'heavy' | 'slim';

export interface PanelVariant {
  /** Nameplate printed on the glare shield. */
  plate: string;
  layout: PanelLayout;
  canopy: CanopyStyle;
  /** Instrument accent colour (readouts, screen glow). */
  accent: string;
  /** Console body colour (dark). */
  body: string;
  /** Console trim colour. */
  trim: string;
  /** Number of round dials beside the screens (0–3). */
  dials: 0 | 1 | 2 | 3;
  /** Number of cockpit seats shown as a second nameplate strip. */
  seats: 1 | 2;
}

const V = (
  plate: string, layout: PanelLayout, canopy: CanopyStyle, accent: string, body: string, trim: string,
  dials: 0 | 1 | 2 | 3, seats: 1 | 2 = 1,
): PanelVariant => ({ plate, layout, canopy, accent, body, trim, dials, seats });

export const PANEL_VARIANTS: Readonly<Record<string, PanelVariant>> = {
  'viper-t21': V('VIPER T21', 'compact', 'bubble', '#9dffb8', '#101a16', '#5f7468', 2),
  'atlantic-9': V('ATLANTIC 9', 'twin', 'framed', '#8fe3ff', '#0e1822', '#586f80', 3),
  'strike-15': V('STRIKE 15', 'wide', 'heavy', '#ffd27a', '#1a1710', '#7d7152', 3),
  'shadow-35': V('SHADOW 35', 'compact', 'slim', '#b7a4ff', '#12101c', '#5b5578', 0),
  'aurora-07': V('AURORA 07', 'stack', 'framed', '#ffa98a', '#1a1210', '#7b5f55', 2),
  'titan-99': V('TITAN 99', 'wide', 'heavy', '#ffc470', '#19150f', '#756a4e', 3, 2),
  'falcon-16': V('FALCON 16', 'compact', 'bubble', '#a6ffcf', '#0f1a17', '#58786a', 1),
  'spectre-03': V('SPECTRE 03', 'twin', 'slim', '#7fffe0', '#0c1a1a', '#4f7370', 1),
  'thunder-97': V('THUNDER 97', 'wide', 'heavy', '#d6ff8a', '#161a0f', '#6b7a4a', 3),
  'raptor-22': V('RAPTOR 22', 'twin', 'slim', '#8affc2', '#0e1712', '#566e63', 1),
  'tornado-04': V('TORNADO 04', 'stack', 'framed', '#ffb27a', '#1a130e', '#7a6150', 2, 2),
  'typhoon-08': V('TYPHOON 08', 'twin', 'bubble', '#9fe8ff', '#0d1719', '#52707a', 2),
  'athena-s': V('ATHENA S', 'compact', 'slim', '#ff9fd2', '#1a0f16', '#7a5568', 0),
  'black-eagle-12': V('BLACK EAGLE 12', 'wide', 'framed', '#c9d4ff', '#10121a', '#5c6580', 3, 2),
  'apollo-castle-37': V('APOLLO CASTLE 37', 'wide', 'heavy', '#ffe08a', '#1a170d', '#80764a', 3, 2),
  'hornet-18': V('HORNET 18', 'stack', 'bubble', '#9affc0', '#0f1914', '#5b7567', 2),
};

const FALLBACK: PanelVariant = V('GENERIC', 'twin', 'framed', '#a8ffc9', '#0b1410', '#53645b', 2);

export function variantFor(key: string): PanelVariant {
  return PANEL_VARIANTS[key] ?? FALLBACK;
}

/** Head offset (px) from turning the head: the eye sits ahead of the neck pivot, so the panel slides. */
export function headShift(yaw: number, pitch: number, neckPx = 70): { x: number; y: number } {
  const cy = Math.max(-1.4, Math.min(1.4, yaw));
  const cp = Math.max(-1.0, Math.min(1.0, pitch));
  return { x: -Math.sin(cy) * neckPx, y: Math.sin(cp) * neckPx * 0.55 };
}
