import 'dotenv/config';
import path from 'path';
import { DataSource } from 'typeorm';
import { Attendance } from './entities/attendance.entity';
import { AuditLog } from './entities/audit-log.entity';
import { ClassSchedule } from './entities/class-schedule.entity';
import { Enrollment } from './entities/enrollment.entity';
import { Module } from './entities/module.entity';
import { User } from '../modules/users/entities/user.entity';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required. Copy .env.example to .env and set your Neon connection string.',
  );
}

const migrationsPattern = path
  .relative(process.cwd(), path.join(__dirname, 'migrations', '*{.ts,.js}'))
  .split(path.sep)
  .join('/');

export default new DataSource({
  type: 'postgres',
  url: databaseUrl,
  entities: [Attendance, AuditLog, ClassSchedule, Enrollment, Module, User],
  migrations: [migrationsPattern],
  synchronize: false,
  migrationsRun: false,
  migrationsTableName: 'migrations',
});

