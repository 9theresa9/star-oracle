import { Module,Global } from '@nestjs/common';
import { PublicController } from './public.controller.js';
import { OracleController } from './oracle.controller.js';
import { AdminController } from './admin.controller.js';
import { OracleService } from './oracle.service.js';
import { AdminService } from './admin.service.js';
import { PersonalController } from './personal.controller.js';
import { PersonalService } from './personal.service.js';
import { SessionGuard,AdminGuard } from './security.js';
@Global()
@Module({providers:[SessionGuard,AdminGuard],exports:[SessionGuard,AdminGuard]})
class SecurityModule {}
@Module({controllers:[OracleController],providers:[OracleService]})
class OracleModule {}
@Module({controllers:[AdminController],providers:[AdminService]})
class AdministrationModule {}
@Module({controllers:[PersonalController],providers:[PersonalService]})
class PersonalModule {}
@Module({imports:[SecurityModule,OracleModule,AdministrationModule,PersonalModule],controllers:[PublicController]})
export class AppModule {}
