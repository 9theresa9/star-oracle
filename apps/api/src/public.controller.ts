import { Controller,Get } from '@nestjs/common';
import { SPREADS,SCENARIOS,ICHING_METHODS } from '@star-oracle/domain';
import { db,redis } from './infrastructure.js';
import { config } from './config.js';
@Controller('api/v1')
export class PublicController {
 @Get('health') async health(){await db.$queryRaw`SELECT 1`;await redis.ping();return {status:'ok'};}
 @Get('config') config(){return {aiEnabled:!!config.AI_API_KEY,aiProvider:config.AI_PROVIDER_NAME,timeZone:'Asia/Shanghai',privacy:'shared-only',features:{tarot:true,iching:true,conversations:true,privateMetadata:true},paymentEnabled:false};}
 @Get('oracle/catalog') catalog(){return {spreads:SPREADS,scenarios:SCENARIOS,ichingMethods:ICHING_METHODS,timeZone:'Asia/Shanghai'};}
}
