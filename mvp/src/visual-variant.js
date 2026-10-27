// A presentation choice only: no storage, account or health-data side effects.
export const contourVariant=new URLSearchParams(globalThis.location?.search||'').get('background')==='static'?'static':'p1';
