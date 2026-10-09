import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException, ConflictException, ServiceUnavailableException, Catch, ExceptionFilter, ArgumentsHost, HttpException } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request,Response } from 'express';
import { createHmac } from 'node:crypto';
import { auth } from './auth.js';
import { db } from './infrastructure.js';
import { config } from './config.js';
export type Actor={id:string;name:string;email:string;role:string;twoFactorEnabled:boolean;sessionBinding:string};
export type AppRequest=Request & {actor:Actor;requestId:string};
export async function resolveActor(req:Pick<Request,'headers'>):Promise<Actor>{
 try{
  const session=await auth.api.getSession({headers:fromNodeHeaders(req.headers)});
  if(!session)throw new UnauthorizedException('请先登录');
  const [user,live]=await Promise.all([db.user.findUnique({where:{id:session.user.id}}),db.session.findUnique({where:{id:session.session.id}})]);
  if(!user||user.disabled||!live||live.expiresAt<=new Date())throw new UnauthorizedException('会话已失效');
  const sessionBinding=createHmac('sha256',config.AUTH_SECRET).update('browser-session:'+live.id).digest('hex');
  if((req.headers['x-expected-actor']&&req.headers['x-expected-actor']!==user.id)||(req.headers['x-expected-session']&&req.headers['x-expected-session']!==sessionBinding))throw new ConflictException({message:'账户状态已变化，请重新确认后再操作。',code:'SESSION_CHANGED'});
  return {sessionBinding,id:user.id,name:user.name,email:user.email,role:user.role,twoFactorEnabled:user.twoFactorEnabled};
 }catch(error){if(error instanceof HttpException)throw error;throw new ServiceUnavailableException('登录服务暂时不可用');}
}
@Injectable()
export class SessionGuard implements CanActivate {
 async canActivate(context:ExecutionContext){
  const req=context.switchToHttp().getRequest<AppRequest>();req.actor=await resolveActor(req);
  const res=context.switchToHttp().getResponse<Response>();res.setHeader('X-Actor-Id',req.actor.id);res.setHeader('X-Session-Binding',req.actor.sessionBinding);return true;
 }
}
@Injectable()
export class AdminGuard implements CanActivate {
 canActivate(context:ExecutionContext) {
   const req=context.switchToHttp().getRequest<AppRequest>();
   if(req.actor?.role!=='admin') throw new ForbiddenException('需要管理员权限');
   if(config.ADMIN_REQUIRE_2FA==='true'&&!req.actor.twoFactorEnabled) throw new ForbiddenException('请先在账户设置启用两步验证');
   return true;
 }
}
@Catch()
export class SafeErrorFilter implements ExceptionFilter {
 catch(error:unknown,host:ArgumentsHost) {
   const ctx=host.switchToHttp(),res=ctx.getResponse<Response>(),req=ctx.getRequest<AppRequest>();
   const status=error instanceof HttpException?error.getStatus():503;
   const message=error instanceof HttpException?error.message:'服务暂时不可用，请稍后再试';
   if(status>=500) console.error(JSON.stringify({event:'request_failed',requestId:req.requestId,status}));
   const detail=error instanceof HttpException?error.getResponse():null;
   const code=detail&&typeof detail==='object'&&'code' in detail&&['SESSION_CHANGED','AI_ATTEMPT_FAILED'].includes(String(detail.code))?String(detail.code):undefined;
   res.status(status).json({error:{message,code,requestId:req.requestId}});
 }
}
