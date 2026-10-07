import { Injectable, Logger } from '@nestjs/common';

// Where SMS go. A real Bangladeshi gateway (SSL Wireless, BulkSMSBD, …)
// becomes another implementation selected by SMS_PROVIDER.
export abstract class SmsSender {
  abstract send(phone: string, text: string): Promise<void>;
}

/** Dev only: prints the message to the API log. Refused in production (env.ts). */
@Injectable()
export class ConsoleSmsSender extends SmsSender {
  private readonly logger = new Logger('SMS');

  send(phone: string, text: string) {
    this.logger.log(`to ${phone}: ${text}`);
    return Promise.resolve();
  }
}
