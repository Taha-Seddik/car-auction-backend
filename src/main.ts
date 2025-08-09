import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: '*'}); // allow your local file/index.html to POST
  app.enableShutdownHooks(); // ensures OnModuleDestroy runs on SIGINT/SIGTERM
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
