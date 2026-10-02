import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException, ServiceUnavailableException, Catch, ExceptionFilter, ArgumentsHost, HttpException } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request,Response } from 'express';
import { auth } from './auth.js';
import { db } from './infrastructure.js';
import { config } from './config.js';
export type Actor={id:string;name:string;email:string;role:string;twoFactorEnabled:boolean};
export type AppRequest=Request & {actor:Actor;requestId:string};
@Injectable()
export class SessionGuard implements CanActivate {
 async canActivate(context:ExecutionContext) {
   const req=context.switchToHttp().getRequest<AppRequest>();
   try {
     const session=await auth.api.getSession({headers:fromNodeHeaders(req.headers)});
     if(!session) throw new UnauthorizedException('请先登录');
     const [user,live]=await Promise.all([db.user.findUnique({where:{id:session.user.id}}),db.session.findUnique({where:{id:session.session.id}})]);
     if(!user||user.disabled||!live||live.expiresAt<=new Date()) throw new UnauthorizedException('会话已失效');
     req.actor={id:user.id,name:user.name,email:user.email,role:user.role,twoFactorEnabled:user.twoFactorEnabled};
     return true;
   } catch(error) {
     if(error instanceof HttpException) throw error;
     throw new ServiceUnavailableException('登录服务暂时不可用');
   }
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
   res.status(status).json({error:{message,requestId:req.requestId}});
 }
}
