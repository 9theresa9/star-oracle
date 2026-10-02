import { Controller,Get,Post,Patch,Delete,Body,Param,Query,Req,UseGuards,HttpCode,ParseUUIDPipe,Inject } from '@nestjs/common';
import { CreateReading,JournalInput,ShareInput,PageQuery,AIInput,UserStatus,type CreateReadingInput,type JournalData } from '@star-oracle/contracts';
import { OracleService } from './oracle.service.js';
import { AdminService } from './admin.service.js';
import { SessionGuard,AdminGuard,type AppRequest } from './security.js';
import { SchemaPipe } from './validation.js';
import { db,redis } from './infrastructure.js';
import { config } from './config.js';
@Controller('api/v1')
export class PublicController {
 @Get('health') async health(){await db.$queryRaw`SELECT 1`;await redis.ping();return {status:'ok'};}
 @Get('config') config(){return {aiEnabled:!!config.AI_API_KEY,timeZone:'Asia/Shanghai',privacy:'shared-only'};}
}
@Controller('api/v1')
@UseGuards(SessionGuard)
export class OracleController {
 constructor(@Inject(OracleService) private readonly oracle:OracleService){}
 @Get('me') me(@Req()req:AppRequest){return req.actor;}
 @Post('readings') create(@Req()req:AppRequest,@Body(new SchemaPipe(CreateReading))input:CreateReadingInput){return this.oracle.create(req.actor.id,input,req.requestId);}
 @Get('readings') list(@Req()req:AppRequest,@Query(new SchemaPipe(PageQuery))page:{cursor?:string;limit:number}){return this.oracle.list(req.actor.id,page);}
 @Get('readings/:id') get(@Req()req:AppRequest,@Param('id',new ParseUUIDPipe())id:string){return this.oracle.get(req.actor.id,id);}
 @Delete('readings/:id') remove(@Req()req:AppRequest,@Param('id',new ParseUUIDPipe())id:string){return this.oracle.remove(req.actor.id,id,req.requestId);}
 @Patch('readings/:id/sharing') share(@Req()req:AppRequest,@Param('id',new ParseUUIDPipe())id:string,@Body(new SchemaPipe(ShareInput))input:{shared:boolean}){return this.oracle.share(req.actor.id,id,input.shared,req.requestId);}
 @Post('readings/:id/interpret') @HttpCode(200) interpret(@Req()req:AppRequest,@Param('id',new ParseUUIDPipe())id:string,@Body(new SchemaPipe(AIInput))_input:{consent:true}){return this.oracle.interpret(req.actor.id,id,req.requestId);}
 @Post('daily/today') @HttpCode(200) today(@Req()req:AppRequest){return this.oracle.daily(req.actor.id);}
 @Get('daily') daily(@Req()req:AppRequest){return this.oracle.dailyHistory(req.actor.id);}
 @Patch('daily/:id/journal') journal(@Req()req:AppRequest,@Param('id',new ParseUUIDPipe())id:string,@Body(new SchemaPipe(JournalInput))input:JournalData){return this.oracle.journal(req.actor.id,id,input);}
}
@Controller('api/v1/admin')
@UseGuards(SessionGuard,AdminGuard)
export class AdminController {
 constructor(@Inject(AdminService) private readonly admin:AdminService){}
 @Get('overview') overview(){return this.admin.overview();}
 @Get('users') users(){return this.admin.users();}
 @Patch('users/:id/status') status(@Req()req:AppRequest,@Param('id')id:string,@Body(new SchemaPipe(UserStatus))input:{disabled:boolean}){return this.admin.status(req.actor.id,id,input.disabled,req.requestId);}
 @Get('shared-readings') shared(@Req()req:AppRequest){return this.admin.shared(req.actor.id,req.requestId);}
 @Get('audit') audit(){return this.admin.logs();}
}
