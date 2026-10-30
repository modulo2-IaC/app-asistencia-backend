import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AcademicModulesModule } from './modules/academic-modules/academic-modules.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { AttendanceAdminModule } from './modules/attendance-admin/attendance-admin.module';
import { ActivitiesModule } from './modules/activities/activities.module';

import path from 'path';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres' as const,
        url: configService.getOrThrow<string>('DATABASE_URL'),
        autoLoadEntities: true,
        migrations: [
          path
            .relative(
              process.cwd(),
              path.join(__dirname, 'database/migrations/*{.ts,.js}'),
            )
            .split(path.sep)
            .join('/'),
        ],
        migrationsTableName: 'migrations',
        synchronize: false,
        migrationsRun: configService.get<string>('RUN_MIGRATIONS') === 'true',
      }),
    }),
    AuthModule,
    UsersModule,
    AcademicModulesModule,
    AttendanceModule,
    AttendanceAdminModule,
    ActivitiesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
