import { Global, Module } from '@nestjs/common';
import { AppSettingsService } from './app-settings.service';
import { AdminSecretsCryptoService } from './admin-secrets-crypto.service';
import { ServerSecretConfigService } from './server-secret-config.service';

@Global()
@Module({
  providers: [
    AdminSecretsCryptoService,
    ServerSecretConfigService,
    AppSettingsService,
  ],
  exports: [
    AdminSecretsCryptoService,
    ServerSecretConfigService,
    AppSettingsService,
  ],
})
export class SettingsModule {}
