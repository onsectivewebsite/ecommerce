import 'reflect-metadata';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { json } from 'express';
import { AppModule } from './app.module';
import { JsonLogger } from './modules/observability/json-logger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    // Stripe webhook signatures need the raw request body; capture it.
    bodyParser: false,
    // Phase 12: opt in to structured JSON logs when LOG_FORMAT=json.
    ...(process.env.LOG_FORMAT === 'json' ? { logger: new JsonLogger() } : {}),
  });
  app.use(
    json({
      // Bulk CSV imports and large carrier webhook payloads are well under 5 MB.
      limit: '5mb',
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      },
    }),
  );
  const logger = new Logger('Bootstrap');

  const port = Number(process.env.API_PORT ?? 4000);
  const corsOrigins = [
    process.env.BUYER_WEB_URL,
    process.env.SELLER_WEB_URL,
    process.env.ADMIN_WEB_URL,
    process.env.SHIPPING_WEB_URL,
  ].filter(Boolean) as string[];

  app.enableCors({
    origin: corsOrigins.length ? corsOrigins : true,
    credentials: true,
  });
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Onsective API')
    .setDescription('Multi-portal marketplace API. Phase 1 — Foundation & MVP.')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  await app.listen(port);
  logger.log(`Onsective API listening on http://localhost:${port}`);
  logger.log(`Swagger: http://localhost:${port}/docs`);
}

bootstrap();
