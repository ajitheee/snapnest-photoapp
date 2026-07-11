import { Module } from '@nestjs/common';
import { ServerController } from './server.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ServerController],
})
export class ServerModule {}
