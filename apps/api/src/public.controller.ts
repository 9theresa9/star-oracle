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
 @Get('config') config(){return {aiEnabled:!!config.AI_API_KEY,aiProvider:config.AI_PROVIDER_NAME,timeZone:'Asia/Shanghai',privacy:'shared-only'};}
}
