import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-openidconnect';
import { AuthService } from './auth.service';

@Injectable()
export class OidcStrategy extends PassportStrategy(Strategy, 'oidc') {
  constructor(private readonly authService: AuthService) {
    const issuer = process.env.OIDC_ISSUER_URL || '';
    super({
      issuer,
      authorizationURL: `${issuer}/protocol/openid-connect/auth`,
      tokenURL: `${issuer}/protocol/openid-connect/token`,
      userInfoURL: `${issuer}/protocol/openid-connect/userinfo`,
      clientID: process.env.OIDC_CLIENT_ID || '',
      clientSecret: process.env.OIDC_CLIENT_SECRET || '',
      callbackURL: `${process.env.APP_URL || 'http://localhost:3001'}/api/auth/oidc/callback`,
      scope: 'openid email profile',
    });
  }

  async validate(
    issuer: string,
    sub: string,
    profile: any,
    jwtClaims: any,
    accessToken: string,
    refreshToken: string,
    params: any,
    done: (err: any, user?: any) => void,
  ) {
    const email = profile?.emails?.[0]?.value || jwtClaims?.email || profile?.email;
    if (!email) return done(new Error('No email returned from OIDC provider'), undefined);

    const user = await this.authService.findOrCreateOAuthUser({
      provider: 'oidc',
      providerAccountId: sub,
      email,
      name: profile?.displayName || jwtClaims?.name || email,
      accessToken,
      refreshToken,
    });
    done(null, user);
  }
}
