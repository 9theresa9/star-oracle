import { Controller,Get,Post,Patch,Delete,Body,Param,Query,Req,UseGuards,ParseUUIDPipe,Inject } from '@nestjs/common';
import { z } from 'zod';
import { PageQuery } from '@star-oracle/contracts';
import { PersonalService,validDate,type ActionInput,type ActionUpdate,type FeedbackInput,type ReportInput,type Period } from './personal.service.js';
import { MembershipService } from './membership.service.js';
import { SessionGuard,type AppRequest } from './security.js';
import { SchemaPipe } from './validation.js';
import { chinaDate } from './infrastructure.js';
const DateInput=z.string().refine(validDate);
const PeriodQuery=z.object({period:z.enum(['week','month']).default('week'),date:DateInput.default(()=>chinaDate())}).strict();
const CalendarQuery=z.object({month:z.string().regex(/^20\d\d-(0[1-9]|1[0-2])$/).default(()=>chinaDate().slice(0,7))}).strict();
const ActionCreate=z.object({title:z.string().trim().min(1).max(160),detail:z.string().max(1000).optional(),readingId:z.string().uuid().optional(),dueDate:DateInput.nullable().optional()}).strict();
const ActionEdit=z.object({title:z.string().trim().min(1).max(160),detail:z.string().max(1000),dueDate:DateInput.nullable(),completed:z.boolean(),version:z.number().int().nonnegative()}).strict();
const ActionPage=PageQuery.extend({status:z.enum(['all','open','done']).default('all')});
const FeedbackCreate=z.object({category:z.enum(['bug','idea','account','other']),body:z.string().trim().min(2).max(2000)}).strict();
const ReportCreate=z.object({period:z.enum(['week','month']),date:DateInput,includeJournal:z.boolean().default(false),consent:z.literal(true),requestId:z.string().uuid()}).strict();
const RedeemInput=z.object({code:z.string().trim().min(18).max(80).regex(/^[A-Za-z0-9-]+$/)}).strict();
const ContentQuery=PageQuery.extend({kind:z.enum(['announcement','guide']).optional()});
const SlugPipe=new SchemaPipe(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80));
@Controller('api/v1')
@UseGuards(SessionGuard)
export class PersonalController {
 constructor(@Inject(PersonalService)private readonly personal:PersonalService,@Inject(MembershipService)private readonly membership:MembershipService){}
 @Get('calendar') calendar(@Req()req:AppRequest,@Query(new SchemaPipe(CalendarQuery))query:{month:string}){return this.personal.calendar(req.actor.id,query.month);}
 @Get('insights') insights(@Req()req:AppRequest,@Query(new SchemaPipe(PeriodQuery))query:{period:Period;date:string}){return this.personal.insights(req.actor.id,query.period,query.date);}
 @Get('insights/reports') reports(@Req()req:AppRequest,@Query(new SchemaPipe(PageQuery))page:{cursor?:string;limit:number}){return this.personal.reports(req.actor.id,page);}
 @Delete('insights/reports/:id') removeReport(@Req()req:AppRequest,@Param('id',new ParseUUIDPipe())id:string){return this.personal.removeReport(req.actor.id,id,req.requestId);}
 @Post('insights/reports') report(@Req()req:AppRequest,@Body(new SchemaPipe(ReportCreate))input:ReportInput){return this.personal.report(req.actor.id,input,req.requestId);}
 @Get('actions') actions(@Req()req:AppRequest,@Query(new SchemaPipe(ActionPage))page:{cursor?:string;limit:number;status:'all'|'open'|'done'}){return this.personal.actions(req.actor.id,page);}
 @Get('actions/:id') action(@Req()req:AppRequest,@Param('id',new ParseUUIDPipe())id:string){return this.personal.action(req.actor.id,id);}
 @Post('actions') createAction(@Req()req:AppRequest,@Body(new SchemaPipe(ActionCreate))input:ActionInput){return this.personal.createAction(req.actor.id,input,req.requestId);}
 @Patch('actions/:id') updateAction(@Req()req:AppRequest,@Param('id',new ParseUUIDPipe())id:string,@Body(new SchemaPipe(ActionEdit))input:ActionUpdate){return this.personal.updateAction(req.actor.id,id,input,req.requestId);}
 @Delete('actions/:id') removeAction(@Req()req:AppRequest,@Param('id',new ParseUUIDPipe())id:string){return this.personal.removeAction(req.actor.id,id,req.requestId);}
 @Get('feedback') feedback(@Req()req:AppRequest,@Query(new SchemaPipe(PageQuery))page:{cursor?:string;limit:number}){return this.personal.feedback(req.actor.id,page);}
 @Post('feedback') createFeedback(@Req()req:AppRequest,@Body(new SchemaPipe(FeedbackCreate))input:FeedbackInput){return this.personal.createFeedback(req.actor.id,input,req.requestId);}
 @Get('membership') member(@Req()req:AppRequest){return this.membership.get(req.actor.id);}
 @Get('membership/redemptions') redemptions(@Req()req:AppRequest,@Query(new SchemaPipe(PageQuery))page:{cursor?:string;limit:number}){return this.membership.redemptions(req.actor.id,page);}
 @Get('membership/ledger') ledger(@Req()req:AppRequest,@Query(new SchemaPipe(PageQuery))page:{cursor?:string;limit:number}){return this.membership.ledger(req.actor.id,page);}
 @Get('membership/payment-options') paymentOptions(){return this.membership.paymentOptions();}
 @Post('membership/redeem') redeem(@Req()req:AppRequest,@Body(new SchemaPipe(RedeemInput))input:{code:string}){return this.membership.redeem(req.actor.id,input.code,req.requestId);}
 @Get('me/export') export(@Req()req:AppRequest){return this.personal.export(req.actor.id);}
}
@Controller('api/v1/content')
export class ContentController {
 constructor(@Inject(PersonalService)private readonly personal:PersonalService){}
 @Get() content(@Query(new SchemaPipe(ContentQuery))page:{cursor?:string;limit:number;kind?:'announcement'|'guide'}){return this.personal.content(page);}
 @Get(':slug') item(@Param('slug',SlugPipe)slug:string){return this.personal.contentItem(slug);}
}
