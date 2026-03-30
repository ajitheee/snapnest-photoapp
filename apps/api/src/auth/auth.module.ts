import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { GoogleStrategy } from './google.strategy';
import { OidcStrategy } from './oidc.strategy';
import { UsersModule } from '../users/users.module';
import { PrismaModule } from '../prisma/prisma.module';

const ssoProviders = [];
if (process.env.GOOGLE_CLIENT_ID) ssoProviders.push(GoogleStrategy);
if (process.env.OIDC_ISSUER_URL) ssoProviders.push(OidcStrategy);

@Module({
  imports: [
    UsersModule,
    PrismaModule,
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'change-me-in-production',
      signOptions: { expiresIn: '30d' },
    }),
  ],
  providers: [AuthService, JwtStrategy, ...ssoProviders],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
