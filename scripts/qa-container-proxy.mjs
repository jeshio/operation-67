import net from 'node:net';
for(const port of [5179,5197])net.createServer(client=>{
 const upstream=net.connect(port,'host.docker.internal');client.setNoDelay(true);upstream.setNoDelay(true);client.pipe(upstream).pipe(client);
 client.on('error',()=>upstream.destroy());upstream.on('error',()=>client.destroy());client.on('close',()=>upstream.destroy());
}).listen(port,'127.0.0.1');
