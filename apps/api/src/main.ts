import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import helmet from 'helmet';
import { randomUUID,createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './auth.js';
import { config } from './config.js';
import { db,redis,consumeLimit,connectRedis } from './infrastructure.js';
import { AppModule } from './app.module.js';
import { HttpException } from '@nestjs/common';
import { SafeErrorFilter,resolveActor } from './security.js';
export async function createApp() {
 const server=express();
 server.disable('x-powered-by');
 server.set('trust proxy',config.TRUST_PROXY==='false'?false:config.TRUST_PROXY);
 server.use(helmet({contentSecurityPolicy:false}));
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
  if(req.headers['x-expected-actor']||req.headers['x-expected-session']){
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
 await connectRedis();
 await db.$connect();
 await redis.ping();
 const app=await createApp();
 const server=await app.listen(config.PORT,'0.0.0.0');
 server.requestTimeout=15000;server.headersTimeout=10000;server.maxHeadersCount=64;
 console.log(JSON.stringify({event:'api_ready',port:config.PORT}));
 const close=async()=>{await app.close();await db.$disconnect();redis.disconnect();};
 process.once('SIGTERM',()=>{void close();});process.once('SIGINT',()=>{void close();});
}
if(process.argv[1]===fileURLToPath(import.meta.url)) bootstrap().catch(error=>{console.error(JSON.stringify({event:'api_start_failed',errorClass:error?.constructor?.name??'Error',code:error?.code??null}));process.exit(1);});
