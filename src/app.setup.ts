import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import type { Env } from './config/env.js';

// Everything main.ts applies to the app, shared with the e2e tests so they
// exercise the same validation and CORS rules as the real server.
export function configureApp(app: INestApplication) {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  // Versioned API (SYSTEM_DESIGN.md: base path /v1); health stays at /health
  // for the hosting platform's checks.
  app.setGlobalPrefix('v1', { exclude: ['health'] });

  // Guest cart and session cookies.
  app.use(cookieParser());

  // Real client IPs behind the hosting proxy (rate limits, session ip).
  if (config.get('NODE_ENV', { infer: true }) === 'production') {
    (app.getHttpAdapter().getInstance() as { set(key: string, value: unknown): void }).set('trust proxy', 1);
  }

  // Errors always leave as { statusCode, code, message }.
  app.useGlobalFilters(new HttpExceptionFilter());

  // Every request body/query goes through DTO validation (ARCHITECTURE.md
  // security baseline): unknown fields are rejected and types are coerced.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // Only the storefront may call the API from a browser. Credentials allow
  // the session cookie (decision D4).
  app.enableCors({ origin: config.get('WEB_ORIGIN', { infer: true }), credentials: true });

  // OpenAPI docs (decision D8): the storefront's typed client is generated
  // from /docs-json. Not exposed in production.
  if (config.get('NODE_ENV', { infer: true }) !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('UNA Mart API')
        .setDescription('Money fields are integer poisha (1 BDT = 100 poisha).')
        .setVersion('0.1')
        .build(),
    );
    SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs-json' });
  }

  return config;
}
