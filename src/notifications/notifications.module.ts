import { Global, Module } from '@nestjs/common';
import { ConsoleSmsSender, SmsSender } from './sms.js';

@Global()
@Module({
  providers: [{ provide: SmsSender, useClass: ConsoleSmsSender }],
  exports: [SmsSender],
})
export class NotificationsModule {}
