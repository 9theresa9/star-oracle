import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import helmet from 'helmet';
import { randomUUID,createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { toNodeHandler,fromNodeHeaders } from 'better-auth/node';
import { auth } from './auth.js';
import { config } from './config.js';
import { db,redis,consumeLimit,connectRedis } from './infrastructure.js';
import { AppModule } from './app.module.js';
import { HttpException } from '@nestjs/common';
import { SafeErrorFilter,resolveActor } from './security.js';
import { sshRequestAllowed,assertSshContainerBoundary } from './ssh-transport.js';
export async function createApp() {
 const server=express();
 server.disable('x-powered-by');
 server.set('trust proxy',config.TRUST_PROXY==='false'?false:config.TRUST_PROXY);
 if(config.DEPLOYMENT_MODE==='ssh-only')server.use((req,res,next)=>{
  if(!sshRequestAllowed(req,config.SSH_ONLY_CONTAINER==='true')){res.status(403).json({error:{message:'仅允许已配置的 SSH 本机入口'}});return;}
  next();
 });
 server.use(helmet({contentSecurityPolicy:false,...(config.DEPLOYMENT_MODE==='ssh-only'?{strictTransportSecurity:false}:{})}));
 server.use((req,res,next)=>{
  res.setHeader('Cache-Control','no-store');
  const requestId=randomUUID();Object.assign(req,{requestId});res.setHeader('X-Request-ID',requestId);
  req.headers['x-real-ip']=req.ip??req.socket.remoteAddress??'unknown';
  const origin=req.headers.origin;
  if(origin&&origin!==config.WEB_ORIGIN){res.status(403).json({error:{message:'来源不受信任',requestId}});return;}
  if(origin===config.WEB_ORIGIN) {
   res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
   res.setHeader('Access-Control-Allow-Credentials','true');
   res.setHeader('Access-Control-Allow-Headers','Content-Type, X-Expected-Actor, X-Expected-Session');
   res.setHeader('Access-Control-Expose-Headers','X-Actor-Id, X-Session-Binding, X-Request-ID');
   res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');
  }
  if(req.method==='OPTIONS'){res.sendStatus(204);return;}
  if(!['GET','HEAD'].includes(req.method)&&origin!==config.WEB_ORIGIN){res.status(403).json({error:{message:'请从照见网站提交请求',requestId}});return;}
  if(!['GET','HEAD'].includes(req.method)&&!req.is('application/json')){res.status(415).json({error:{message:'需要 JSON 请求',requestId}});return;}
  if(Number(req.headers['content-length']??0)>32768){res.status(413).json({error:{message:'请求太大',requestId}});return;}
  next();
 });
 server.use(async(req,res,next)=>{
  if(req.path==='/api/v1/health'){next();return;}
  try {
   const ip=createHmac('sha256',config.AUTH_SECRET).update(req.ip??req.socket.remoteAddress??'unknown').digest('hex');
   if(!await consumeLimit('http:'+ip,120,60)){res.status(429).json({error:{message:'请求过于频繁'}});return;}
   next();
  }catch{res.status(503).json({error:{message:'安全服务暂时不可用'}});}
 });
 const authHandler=toNodeHandler(auth);
 server.all('/api/auth/*splat',async(req,res,next)=>{
  const path=req.path.slice('/api/auth'.length);
  const allowed=req.method==='GET'?path==='/get-session':req.method==='POST'&&[
   '/sign-in/username','/sign-out','/delete-user','/two-factor/enable','/two-factor/disable',
   '/two-factor/verify-totp','/two-factor/verify-backup-code',
  ].includes(path);
  if(!allowed){res.status(404).json({message:'此账户入口未开放'});return;}
  // A cached Better Auth session is not proof of a live, provisioned DB session.
  // TOTP supports both anonymous login challenges and authenticated enrollment.
  let mustResolve=!!(req.headers['x-expected-actor']||req.headers['x-expected-session'])||['/delete-user','/two-factor/enable','/two-factor/disable'].includes(path);
  if(!mustResolve&&['/get-session','/two-factor/verify-totp','/two-factor/verify-backup-code'].includes(path)){
   try{mustResolve=!!await auth.api.getSession({headers:fromNodeHeaders(req.headers)});}catch{res.status(503).json({message:'账户确认暂时不可用'});return;}
  }
  if(mustResolve){
   try{await resolveActor(req);}catch(error){
    const status=error instanceof HttpException?error.getStatus():503;
    const detail=error instanceof HttpException?error.getResponse():null;
    res.status(status).json({message:error instanceof HttpException?error.message:'账户确认暂时不可用',code:detail&&typeof detail==='object'&&'code' in detail&&detail.code==='SESSION_CHANGED'?'SESSION_CHANGED':undefined});return;
   }
  }
  let bytes=0;
  req.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>32768)req.destroy();});
  Promise.resolve(authHandler(req,res)).catch(next);
 });
 server.use(express.json({limit:'32kb'}));
 const app=await NestFactory.create(AppModule,new ExpressAdapter(server),{bodyParser:false,logger:['warn','error']});
 app.useGlobalFilters(new SafeErrorFilter());
 app.enableShutdownHooks();
 await app.init();
 server.use((error:unknown,req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  if(res.headersSent)return;
  const kind=(error as {type?:string})?.type;
  res.status(kind==='entity.too.large'?413:kind==='entity.parse.failed'?400:503).json({error:{message:'请求无法完成',requestId:(req as express.Request&{requestId:string}).requestId}});
 });
 return app;
}
async function bootstrap() {
 if(config.DEPLOYMENT_MODE==='ssh-only'&&config.SSH_ONLY_CONTAINER==='true')assertSshContainerBoundary(existsSync('/.dockerenv'),networkInterfaces());
 await connectRedis();
 await db.$connect();
 await redis.ping();
 const app=await createApp();
 const server=await app.listen(config.PORT,config.LISTEN_HOST);
 server.requestTimeout=15000;server.headersTimeout=10000;server.maxHeadersCount=64;
 console.log(JSON.stringify({event:'api_ready',port:config.PORT,deploymentMode:config.DEPLOYMENT_MODE}));
 if(config.DEPLOYMENT_MODE==='ssh-only')console.warn(JSON.stringify({event:'ssh_only_transport',notice:'Only the configured loopback SSH entry is supported. Local HTTP does not protect against malicious local processes. Localhost cookies are not isolated by port. Docker isolation must be verified with the dedicated launcher.'}));
 const close=async()=>{await app.close();await db.$disconnect();redis.disconnect();};
 process.once('SIGTERM',()=>{void close();});process.once('SIGINT',()=>{void close();});
}
if(process.argv[1]===fileURLToPath(import.meta.url)) bootstrap().catch(error=>{console.error(JSON.stringify({event:'api_start_failed',errorClass:error?.constructor?.name??'Error',code:error?.code??null}));process.exit(1);});
