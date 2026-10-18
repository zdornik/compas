import { request } from 'node:http';
import { readFile } from 'node:fs/promises';

// Minimal adapter for Tunnelmole's published MIT client protocol. Uses Node's
// TLS WebSocket and HTTP implementations; no SDK analytics or request logging.
const clientId=(await readFile('/run/secrets/demo_tunnel_client_id','utf8')).trim().slice(0,21);
const socket=new WebSocket('wss://service.tunnelmole.com:8083');
let assigned=false, inflight=0;
const startup=setTimeout(()=>{console.error('Tunnel startup timed out');process.exit(1);},20000);
const send=value=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(value));};
const failure=(message,statusCode)=>send({type:'forwardedResponse',requestId:message.requestId,url:message.url,statusCode,headers:{'content-type':'text/plain','cache-control':'no-store'},body:Buffer.from('Demo request unavailable').toString('base64')});
socket.addEventListener('open',()=>send({type:'initialise',clientId,connectionInfo:{isCli:false,isNpm:false,nodeVersion:'v24'}}));
socket.addEventListener('message',event=>{
  if(typeof event.data!=='string' || event.data.length>1500000) {socket.close();return;}
  let message;try{message=JSON.parse(event.data);}catch{return;}
  if(message.type==='hostnameAssigned') {
    if(!/^[a-z0-9-]+\.tunnelmole\.net$/.test(message.hostname)) {socket.close();return;}
    assigned=true;clearTimeout(startup);console.log('Demo URL: https://'+message.hostname);return;
  }
  if(message.type!=='forwardedRequest')return;
  if(inflight>=64) {failure(message,503);return;}
  if(!['GET','HEAD','POST','PUT'].includes(message.method) || typeof message.url!=='string' || !message.url.startsWith('/') || typeof message.body!=='string' || message.body.length>140000) {failure(message,413);return;}
  const body=Buffer.from(message.body,'base64');
  const headers={...message.headers};
  for(const key of Object.keys(headers))if(['connection','proxy-authorization','proxy-connection','transfer-encoding','upgrade'].includes(key.toLowerCase()))delete headers[key];
  inflight++;
  let finished=false;
  const finish=()=>{if(!finished){finished=true;inflight--;return true;}return false;};
  try {
    const upstream=request({hostname:'gate',port:8081,method:message.method,path:message.url,headers,timeout:15000},response=>{
      const chunks=[];let bytes=0;
      response.on('data',chunk=>{bytes+=chunk.length;if(bytes>2000000){response.destroy();if(finish())failure(message,413);}else chunks.push(chunk);});
      response.on('end',()=>{if(finish())send({type:'forwardedResponse',requestId:message.requestId,url:message.url,statusCode:response.statusCode,headers:response.headers,body:Buffer.concat(chunks).toString('base64')});});
      response.on('error',()=>{if(finish())failure(message,502);});
    });
    upstream.on('timeout',()=>upstream.destroy());
    upstream.on('error',()=>{if(finish())failure(message,502);});
    upstream.end(body);
  } catch {if(finish())failure(message,400);}
});
socket.addEventListener('error',()=>{console.error('Tunnel TLS transport failed');process.exit(1);});
socket.addEventListener('close',()=>{clearTimeout(startup);console.error(assigned?'Tunnel connection closed; restart demo:share to obtain a new URL':'Tunnel could not be assigned');process.exit(1);});
