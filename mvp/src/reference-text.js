// One-character glyph substitutions retain source text offsets and styled runs.
export const normalizeReferenceText=value=>String(value||'').replace(/\uf0b7/g,'•').replace(/(^|\n)(\s*)[\uf0a7\uf0d8\u2023\u2043\u25aa\u25cf](?=\s)/g,'$1$2•');

export function sourceSentenceForHit(marked,marker='__COMPASS_HIT__'){
 const text=normalizeReferenceText(marked),at=text.indexOf(marker);
 if(at<0)return text.trim();
 const segments=[...new Intl.Segmenter('ru',{granularity:'sentence'}).segment(text)];
 const selected=segments.find(row=>row.index<=at&&row.index+row.segment.length>at);
 return (selected?.segment||text).replaceAll(marker,'').trim();
}
