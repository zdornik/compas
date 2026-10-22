import {contourPlacement} from './contour-placement.js';
export const AUTH_TRAVEL_MS=980;
export const mix=(a,b,t)=>a+(b-a)*t;
export function sceneAt(from,to,t){
 const figure=Object.fromEntries(['x','y','width'].map(key=>[key,mix(from.figure[key],to.figure[key],t)]));
 const clip=Object.fromEntries(['left','top','width','height'].map(key=>[key,mix(from.clip[key],to.clip[key],t)]));
 const radii=from.radii.map((v,i)=>mix(v,to.radii[i],t));
 return {figure,clip,radii,value:mix(from.value,to.value,t),image:contourPlacement({width:clip.width,height:clip.height,centerX:figure.x,centerY:figure.y,figureWidth:figure.width,figureHeight:figure.width*1408/1126,cover:false})};
}
export function entranceScene(width,height,value=3){
 const mobile=width<=760,figure={x:width*(mobile?.76:.73),y:mobile?154:Math.min(height*.46,420),width:mobile?125:185};
 return sceneAt({figure,clip:{left:0,top:0,width,height},radii:Array(8).fill(0),value},{figure,clip:{left:0,top:0,width,height},radii:Array(8).fill(0),value},0);
}
export async function loginWithRoleDiscovery(input,authenticate){
 return authenticate({...input,role:input.role==='doctor'?'doctor':'patient',discoverRole:true});
}
