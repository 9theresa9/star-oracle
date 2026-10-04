import { Controller,Get,Post,Patch,Delete,Body,Param,Query,Req,UseGuards,HttpCode,ParseUUIDPipe,Inject } from '@nestjs/common';
import { CreateReading,JournalInput,ShareInput,PageQuery,ReadingQuery,ReadingMetadata,ConversationInput,AIInput,DailyQuery,type CreateReadingInput,type JournalData,type ReadingQueryInput,type ReadingMetadataInput,type ConversationInputData } from '@star-oracle/contracts';
import { OracleService } from './oracle.service.js';
import { SessionGuard,type AppRequest } from './security.js';
import { SchemaPipe } from './validation.js';
@Controller('api/v1')
@UseGuards(SessionGuard)
export class OracleController {
 constructor(@Inject(OracleService) private readonly oracle:OracleService){}
 @Get('me') me(@Req()req:AppRequest){return req.actor;}
 @Post('readings') create(@Req()req:AppRequest,@Body(new SchemaPipe(CreateReading))input:CreateReadingInput){return this.oracle.create(req.actor.id,input,req.requestId);}
 @Get('readings') list(@Req()req:AppRequest,@Query(new SchemaPipe(ReadingQuery))page:ReadingQueryInput){return this.oracle.list(req.actor.id,page);}
 @Get('readings/:id') get(@Req()req:AppRequest,@Param('id',new ParseUUIDPipe())id:string){return this.oracle.get(req.actor.id,id);}
 @Delete('readings/:id') remove(@Req()req:AppRequest,@Param('id',new ParseUUIDPipe())id:string){return this.oracle.remove(req.actor.id,id,req.requestId);}
 @Patch('readings/:id/sharing') share(@Req()req:AppRequest,@Param('id',new ParseUUIDPipe())id:string,@Body(new SchemaPipe(ShareInput))input:{shared:boolean}){return this.oracle.share(req.actor.id,id,input.shared,req.requestId);}
 @Patch('readings/:id/metadata') metadata(@Req()req:AppRequest,@Param('id',new ParseUUIDPipe())id:string,@Body(new SchemaPipe(ReadingMetadata))input:ReadingMetadataInput){return this.oracle.metadata(req.actor.id,id,input,req.requestId);}
 @Post('readings/:id/interpret') @HttpCode(200) interpret(@Req()req:AppRequest,@Param('id',new ParseUUIDPipe())id:string,@Body(new SchemaPipe(AIInput))input:{consent:true;requestId?:string}){return this.oracle.interpret(req.actor.id,id,req.requestId,input.requestId);}
 @Get('readings/:id/conversation') conversation(@Req()req:AppRequest,@Param('id',new ParseUUIDPipe())id:string,@Query(new SchemaPipe(PageQuery))page:{cursor?:string;limit:number}){return this.oracle.conversations(req.actor.id,id,page);}
 @Post('readings/:id/conversation') @HttpCode(200) followUp(@Req()req:AppRequest,@Param('id',new ParseUUIDPipe())id:string,@Body(new SchemaPipe(ConversationInput))input:ConversationInputData){return this.oracle.followUp(req.actor.id,id,input,req.requestId);}
 @Post('daily/today') @HttpCode(200) today(@Req()req:AppRequest){return this.oracle.daily(req.actor.id);}
 @Get('daily') daily(@Req()req:AppRequest,@Query(new SchemaPipe(DailyQuery))page:{cursor?:string;limit:number}){return this.oracle.dailyHistory(req.actor.id,page);}
 @Get('daily/:id') dailyOne(@Req()req:AppRequest,@Param('id',new ParseUUIDPipe())id:string){return this.oracle.dailyOne(req.actor.id,id);}
 @Patch('daily/:id/journal') journal(@Req()req:AppRequest,@Param('id',new ParseUUIDPipe())id:string,@Body(new SchemaPipe(JournalInput))input:JournalData){return this.oracle.journal(req.actor.id,id,input);}
}
