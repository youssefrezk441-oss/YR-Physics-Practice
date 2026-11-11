import http from 'node:http';
const PORT=58000;
const memory=new Map();
const routes=new Map([
 ['/functions/v1/paper-homework','http://127.0.0.1:59001/'],
 ['/functions/v1/student-ch2-mistakes','http://127.0.0.1:59002/']
]);
const server=http.createServer(async(req,res)=>{
 const cors={'access-control-allow-origin':req.headers.origin||'http://127.0.0.1:58001','access-control-allow-headers':'authorization,apikey,content-type,x-client-info','access-control-allow-methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS'};
 if(req.method==='OPTIONS'){res.writeHead(204,cors).end();return;}
 try{
  const incoming=new URL(req.url||'/','http://local');
  const route=routes.get(incoming.pathname);
  const auth=incoming.pathname.startsWith('/auth/v1');
  if(!route&&!auth){res.writeHead(404,cors).end('not found');return;}
  const target=auth?'http://127.0.0.1:59999'+(incoming.pathname.slice('/auth/v1'.length)||'/')+incoming.search:route;
  const chunks=[];for await(const c of req)chunks.push(c);
  const upstream=await fetch(target,{method:req.method,headers:Object.fromEntries(Object.entries(req.headers).filter(([k])=>!['host','origin','content-length'].includes(k))),body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
  res.writeHead(upstream.status,{...Object.fromEntries(upstream.headers),...cors});
  res.end(Buffer.from(await upstream.arrayBuffer()));
 }catch(e){console.error('local gateway failed',e);res.writeHead(502,cors).end('synthetic gateway error')}
});
server.listen(PORT,'127.0.0.1',()=>console.log('Lesson-two E2E local gateway at',PORT));