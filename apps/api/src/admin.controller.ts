import { Controller,Get,Post,Patch,Delete,Body,Param,Query,Req,UseGuards,HttpCode,ParseUUIDPipe,Inject } from '@nestjs/common';
import { CreateReading,JournalInput,ShareInput,PageQuery,AIInput,UserStatus,AdminPageQuery,type CreateReadingInput,type JournalData } from '@star-oracle/contracts';
import { OracleService } from './oracle.service.js';
import { AdminService } from './admin.service.js';
import { SessionGuard,AdminGuard,type AppRequest } from './security.js';
import { SchemaPipe } from './validation.js';
import { db,redis } from './infrastructure.js';
import { config } from './config.js';
@Controller('api/v1/admin')
@UseGuards(SessionGuard,AdminGuard)
export class AdminController {
 constructor(@Inject(AdminService) private readonly admin:AdminService){}
 @Get('overview') overview(){return this.admin.overview();}
 @Get('users') users(@Query(new SchemaPipe(AdminPageQuery))page:{cursor?:string;limit:number}){return this.admin.users(page);}
 @Patch('users/:id/status') status(@Req()req:AppRequest,@Param('id')id:string,@Body(new SchemaPipe(UserStatus))input:{disabled:boolean}){return this.admin.status(req.actor.id,id,input.disabled,req.requestId);}
 @Get('shared-readings') shared(@Req()req:AppRequest,@Query(new SchemaPipe(PageQuery))page:{cursor?:string;limit:number}){return this.admin.shared(req.actor.id,req.requestId,page);}
 @Get('audit') audit(@Query(new SchemaPipe(PageQuery))page:{cursor?:string;limit:number}){return this.admin.logs(page);}
}
