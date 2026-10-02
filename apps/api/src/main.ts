import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import helmet from 'helmet';
import { randomUUID,createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './auth.js';
import { config } from './config.js';
import { db,redis,consumeLimit } from './infrastructure.js';
import { PublicController,OracleController,AdminController } from './controllers.js';
import { OracleService } from './oracle.service.js';
import { AdminService } from './admin.service.js';
import { SessionGuard,AdminGuard,SafeErrorFilter } from './security.js';
@Module({controllers:[PublicController,OracleController,AdminController],providers:[OracleService,AdminService,SessionGuard,AdminGuard]})
class AppModule {}
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
   res.setHeader('Access-Control-Allow-Headers','Content-Type');
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
 server.all('/api/auth/*splat',toNodeHandler(auth));
 server.use(express.json({limit:'32kb'}));
 const app=await NestFactory.create(AppModule,new ExpressAdapter(server),{bodyParser:false,logger:['warn','error']});
 app.useGlobalFilters(new SafeErrorFilter());
 app.enableShutdownHooks();
 await app.init();
 return app;
}
async function bootstrap() {
 await db.$connect();
 await redis.ping();
 const app=await createApp();
 const server=await app.listen(config.PORT,'0.0.0.0');
 server.requestTimeout=15000;server.headersTimeout=10000;server.maxHeadersCount=64;
 console.log(JSON.stringify({event:'api_ready',port:config.PORT}));
 const close=async()=>{await app.close();await db.$disconnect();redis.disconnect();};
 process.once('SIGTERM',()=>{void close();});process.once('SIGINT',()=>{void close();});
}
if(process.argv[1]===fileURLToPath(import.meta.url)) bootstrap().catch(()=>{console.error('API startup failed; check configuration and dependencies');process.exit(1);});
