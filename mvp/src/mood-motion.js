// Seven art-directed poses and palettes, interpolated without swapping faces.
export const MOOD_VISUALS = [
  { background: '#dce7f5', scale: 1.09, shift: 5, mouth: -1, eyes: .72, browY: 5, browAngle: -14, browOpacity: .88, tilt: -1.5 },
  { background: '#e3edf8', scale: 1.055, shift: 3, mouth: -.65, eyes: .76, browY: 3, browAngle: -10, browOpacity: .76, tilt: -1 },
  { background: '#edf4fa', scale: 1.02, shift: 1, mouth: -.22, eyes: .8, browY: 1, browAngle: -5, browOpacity: .6, tilt: -.4 },
  { background: '#e4eee9', scale: 1, shift: 0, mouth: .36, eyes: .85, browY: 0, browAngle: 0, browOpacity: .3, tilt: 0 },
  { background: '#f0f1dd', scale: 1.035, shift: -1, mouth: .62, eyes: .88, browY: -1, browAngle: 3, browOpacity: .38, tilt: .4 },
  { background: '#fff7e4', scale: 1.065, shift: -3, mouth: .86, eyes: .92, browY: -2, browAngle: 5, browOpacity: .5, tilt: .8 },
  { background: '#fff2d7', scale: 1.1, shift: -5, mouth: 1.1, eyes: .96, browY: -3, browAngle: 7, browOpacity: .56, tilt: 1.2 },
];

const CONTOUR_PALETTES = [
  { inner: [67, 105, 156], outer: [224, 236, 251] },
  { inner: [110, 151, 190], outer: [232, 242, 251] },
  { inner: [144, 178, 203], outer: [240, 247, 252] },
  { inner: [155, 194, 174], outer: [240, 247, 242] },
  { inner: [185, 201, 149], outer: [247, 249, 232] },
  { inner: [224, 197, 145], outer: [255, 247, 228] },
  { inner: [238, 203, 143], outer: [255, 242, 215] },
];
export function contourPalette(coordinate) {
  const value = Math.max(0, Math.min(6, coordinate));
  const low = Math.floor(value), high = Math.ceil(value), blend = value - low;
  return Object.fromEntries(['inner', 'outer'].map(key => [key, CONTOUR_PALETTES[low][key].map((channel, i) => channel + (CONTOUR_PALETTES[high][key][i] - channel) * blend)]));
}

export function moodVisualAt(coordinate) {
  const value = Math.max(0, Math.min(6, coordinate));
  const low = Math.floor(value), high = Math.ceil(value), blend = value - low;
  const numeric = Object.keys(MOOD_VISUALS[low]).filter(key => typeof MOOD_VISUALS[low][key] === "number");
  return { ...Object.fromEntries(numeric.map(key => [key, MOOD_VISUALS[low][key] + (MOOD_VISUALS[high][key] - MOOD_VISUALS[low][key]) * blend])), background: `rgb(${contourPalette(value).outer.join(",")})` };
}

const CHROME_ACCENTS = [[52,95,147],[75,114,149],[82,116,136],[46,105,89],[97,119,55],[145,98,48],[153,88,28]];
export function moodChromeAt(coordinate) {
  const value = Math.max(0, Math.min(6, coordinate));
  const low = Math.floor(value), high = Math.ceil(value), blend = value - low;
  const color = CHROME_ACCENTS[low].map((c,i) => c + (CHROME_ACCENTS[high][i] - c) * blend);
  return {
    '--accent': `rgb(${color.join(',')})`,
    '--accent-soft': `rgb(${color.map(c => 255 * .91 + c * .09).join(',')})`,
  };
}

// Shared semantic colours for every section, including the editor's live preview.
// Artwork and UI share the same continuous mood coordinate.
export function appThemeAt(coordinate) {
  const chrome = moodChromeAt(coordinate);
  const accent = chrome['--accent'].match(/[\d.]+/g).map(Number);
  const mix = (weight, base = [255, 255, 255]) => `rgb(${accent.map((value, i) => Math.round(value * weight + base[i] * (1 - weight))).join(',')})`;
  return {
    ...chrome,
    '--ui-accent': chrome['--accent'], '--ui-ink': mix(.27, [23, 39, 36]),
    '--ui-text': mix(.35, [63, 78, 69]), '--ui-muted': mix(.2, [111, 124, 116]),
    '--ui-faint': mix(.14, [142, 152, 144]), '--ui-surface': mix(.035), '--ui-paper': mix(.025),
    '--ui-soft': mix(.075), '--ui-selected': mix(.13), '--ui-line': mix(.16),
    '--ui-border': mix(.3), '--ui-midtone': mix(.65),
    '--surface': mix(.035), '--line': mix(.16), '--muted': mix(.2, [111, 124, 116]),
    '--hero-bg': moodVisualAt(coordinate).background,
  };
}
