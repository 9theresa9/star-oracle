import { Controller,Get } from '@nestjs/common';
import { SPREADS,SCENARIOS } from '@star-oracle/domain';
import { db,redis } from './infrastructure.js';
import { config } from './config.js';
@Controller('api/v1')
export class PublicController {
 @Get('health') async health(){await db.$queryRaw`SELECT 1`;await redis.ping();return {status:'ok'};}
 @Get('config') config(){return {aiEnabled:!!config.AI_API_KEY,aiProvider:config.AI_PROVIDER_NAME,timeZone:'Asia/Shanghai',privacy:'shared-only',features:{tarot:true,iching:true,conversations:true,privateMetadata:true},paymentEnabled:false};}
 @Get('oracle/catalog') catalog(){return {spreads:SPREADS,scenarios:SCENARIOS,ichingMethods:[{id:'coins',name:'三枚硬币',description:'三枚硬币，逐爻生成六爻。'},{id:'numbers',name:'数字起卦',description:'现代数字起卦：先天八卦序，上卦第一数、下卦第二数、动爻第三数取六的余数，余零按六。'},{id:'time',name:'时间起卦',description:'以上海时区公历时间计算的现代起卦规则，非农历传统排盘。'}],timeZone:'Asia/Shanghai'};}
}
