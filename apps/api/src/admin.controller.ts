import { Controller,Get,Post,Patch,Body,Param,Query,Req,UseGuards,ParseUUIDPipe,Inject } from '@nestjs/common';
import { z } from 'zod';
import { PageQuery,UserStatus,AdminPageQuery } from '@star-oracle/contracts';
import { AdminService } from './admin.service.js';
import { MembershipService,type CodeInput,type MemberUpdate } from './membership.service.js';
import { SessionGuard,AdminGuard,type AppRequest } from './security.js';
import { SchemaPipe } from './validation.js';
const ContentInput=z.object({slug:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),kind:z.enum(['announcement','guide']),title:z.string().trim().min(1).max(160),body:z.string().max(10000),published:z.boolean()}).strict();
const ContentUpdate=ContentInput.extend({version:z.number().int().nonnegative()});
const ContentPage=PageQuery.extend({kind:z.enum(['announcement','guide']).optional()});
const FeedbackPage=PageQuery.extend({status:z.enum(['open','in_progress','resolved']).optional()});
const ReplyInput=z.object({status:z.enum(['open','in_progress','resolved']),reply:z.string().max(2000),version:z.number().int().nonnegative()}).strict();
const StatsQuery=z.object({days:z.coerce.number().refine(value=>value===30||value===90).default(30)}).strict();
const Expiration=z.string().datetime({offset:true}).nullable().optional();
const RedeemCreate=z.object({kind:z.enum(['credits','membership']),amount:z.number().int().min(1).max(1000000),durationDays:z.number().int().min(1).max(3650).optional(),expiresAt:Expiration,maxUses:z.number().int().min(1).max(10000).default(1)}).strict().refine(value=>value.kind==='credits'||value.durationDays!==undefined||value.amount<=3650);
const CodeStatus=z.object({disabled:z.boolean()}).strict();
const MembershipInput=z.object({tier:z.enum(['free','plus']),expiresAt:Expiration,credits:z.number().int().min(0).max(100000000).optional()}).strict();
const UserId=new SchemaPipe(z.string().regex(/^[a-zA-Z0-9-]{8,80}$/));
@Controller('api/v1/admin')
@UseGuards(SessionGuard,AdminGuard)
export class AdminController {
 constructor(@Inject(AdminService)private readonly admin:AdminService,@Inject(MembershipService)private readonly membership:MembershipService){}
 @Get('overview') overview(){return this.admin.overview();}
 @Get('statistics') statistics(@Query(new SchemaPipe(StatsQuery))query:{days:30|90}){return this.admin.statistics(query.days);}
 @Get('users') users(@Query(new SchemaPipe(AdminPageQuery))page:{cursor?:string;limit:number}){return this.admin.users(page);}
 @Patch('users/:id/status') status(@Req()req:AppRequest,@Param('id',UserId)id:string,@Body(new SchemaPipe(UserStatus))input:{disabled:boolean}){return this.admin.status(req.actor.id,id,input.disabled,req.requestId);}
 @Patch('users/:id/membership') assign(@Req()req:AppRequest,@Param('id',UserId)id:string,@Body(new SchemaPipe(MembershipInput))input:MemberUpdate){return this.membership.assign(req.actor.id,id,input,req.requestId);}
 @Get('shared-readings') shared(@Req()req:AppRequest,@Query(new SchemaPipe(PageQuery))page:{cursor?:string;limit:number}){return this.admin.shared(req.actor.id,req.requestId,page);}
 @Get('audit') audit(@Query(new SchemaPipe(PageQuery))page:{cursor?:string;limit:number}){return this.admin.logs(page);}
 @Get('content') content(@Query(new SchemaPipe(ContentPage))page:{cursor?:string;limit:number;kind?:'announcement'|'guide'}){return this.admin.content(page);}
 @Post('content') createContent(@Req()req:AppRequest,@Body(new SchemaPipe(ContentInput))input:{slug:string;kind:'announcement'|'guide';title:string;body:string;published:boolean}){return this.admin.createContent(req.actor.id,input,req.requestId);}
 @Patch('content/:id') updateContent(@Req()req:AppRequest,@Param('id',new ParseUUIDPipe())id:string,@Body(new SchemaPipe(ContentUpdate))input:{slug:string;kind:'announcement'|'guide';title:string;body:string;published:boolean;version:number}){return this.admin.updateContent(req.actor.id,id,input,req.requestId);}
 @Get('feedback') feedback(@Req()req:AppRequest,@Query(new SchemaPipe(FeedbackPage))page:{cursor?:string;limit:number;status?:'open'|'in_progress'|'resolved'}){return this.admin.feedback(req.actor.id,req.requestId,page);}
 @Patch('feedback/:id') replyFeedback(@Req()req:AppRequest,@Param('id',new ParseUUIDPipe())id:string,@Body(new SchemaPipe(ReplyInput))input:{status:'open'|'in_progress'|'resolved';reply:string;version:number}){return this.admin.replyFeedback(req.actor.id,id,input,req.requestId);}
 @Get('redeem-codes') codes(@Query(new SchemaPipe(PageQuery))page:{cursor?:string;limit:number}){return this.membership.codes(page);}
 @Post('redeem-codes') createCode(@Req()req:AppRequest,@Body(new SchemaPipe(RedeemCreate))input:CodeInput){return this.membership.createCode(req.actor.id,input,req.requestId);}
 @Patch('redeem-codes/:id') codeStatus(@Req()req:AppRequest,@Param('id',new ParseUUIDPipe())id:string,@Body(new SchemaPipe(CodeStatus))input:{disabled:boolean}){return this.membership.codeStatus(req.actor.id,id,input.disabled,req.requestId);}
}
