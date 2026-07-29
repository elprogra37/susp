import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthGuard } from '../common/auth/auth.guard';
import { CONFIG, SuspConfig } from '../config/configuration';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [CONFIG],
      useFactory: (config: SuspConfig) => ({
        secret: config.jwtSecret,
        signOptions: { issuer: 'susp', audience: 'susp-dashboard' },
        verifyOptions: { issuer: 'susp', audience: 'susp-dashboard' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthGuard],
  exports: [JwtModule, AuthGuard],
})
export class AuthModule {}
