import {cp,mkdir} from 'node:fs/promises';
await mkdir('public/pdf-assets',{recursive:true});
for(const directory of ['cmaps','standard_fonts'])await cp('node_modules/pdfjs-dist/'+directory,'public/pdf-assets/'+directory,{recursive:true});
