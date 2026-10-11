/** Glyph paths for the caption controls the shell draws itself. */
import type { DesktopMessages } from './locale.ts'

/**
 * One drawn control glyph, as SVG path data on a 24-unit grid with a 1px
 * stroke, matching the shared icon library's Regular weight. The shell draws
 * these because the library ships no minimize or maximize/restore glyph, and a
 * preload cannot render a library React component.
 */
export interface CaptionGlyph {
  /** `d` attribute of the glyph's path. */
  readonly path: string
  /** Locale key of the control's label, which is also its tooltip and accessible name. */
  readonly label: keyof DesktopMessages
}

/** Minimize, a single rule on the glyph's vertical center. */
export const CAPTION_MINIMIZE: CaptionGlyph = { path: 'M5 12h14', label: 'windowMinimize' }

/** Maximize, the window outline a restore returns to. */
export const CAPTION_MAXIMIZE: CaptionGlyph = { path: 'M5.5 5.5h13v13h-13z', label: 'windowMaximize' }

/** Restore, the two overlapping outlines that mark a maximized window. */
export const CAPTION_RESTORE: CaptionGlyph = {
  path: 'M8 8.5V5.5h10.5V16h-3M5.5 8.5H16V19H5.5z',
  label: 'windowRestore',
}

/** Close, a diagonal cross matching the shared library's close glyph. */
export const CAPTION_CLOSE: CaptionGlyph = { path: 'M6 6l12 12M18 6L6 18', label: 'windowClose' }
