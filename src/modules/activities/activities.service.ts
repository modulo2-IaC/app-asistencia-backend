import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DEFAULT_TIMEZONE, LocalNow, nowInTimezone } from '../../common/clock';
import { Module } from '../../database/entities/module.entity';
import { AcademicModulesService } from '../academic-modules/academic-modules.service';
import { ListActivitiesDto } from './dto/list-activities.dto';

export interface ActivityUserSummary {
  id: string;
  fullName: string | null;
  registrationNo: string;
  role: string;
}

export interface ActivityStudentSummary {
  id: string;
  fullName: string | null;
  registrationNo: string;
}

export interface ActivityItem {
  id: string;
  createdAt: string;
  action: string;
  actionLabel: string;
  affectedEntity: string | null;
  affectedRecordId: string | null;
  classDate: string | null;
  user: ActivityUserSummary | null;
  student: ActivityStudentSummary | null;
  details: Record<string, unknown>;
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
}

function toNullableString(value: unknown): string | null {
  if (!value) return null;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  return null;
}

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly academicModules: AcademicModulesService,
  ) {}

  /** RF-10: Consulta de actividades del módulo activo con filtros */
  async listActivities(query: ListActivitiesDto) {
    const { module, timeZone } = await this.context();
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 15));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['a.module_id = $1'];
    const params: unknown[] = [module.id];

    if (query.studentId) {
      params.push(query.studentId);
      const idx = params.length;
      conditions.push(`(target.id = $${idx} OR a.user_id = $${idx})`);
    }

    if (query.date) {
      params.push(query.date);
      const dateIdx = params.length;
      params.push(timeZone);
      const tzIdx = params.length;
      conditions.push(
        `(COALESCE(a.new_value->>'classDate', TO_CHAR(s.class_date, 'YYYY-MM-DD')) = $${dateIdx}
          OR TO_CHAR(a.created_at AT TIME ZONE $${tzIdx}, 'YYYY-MM-DD') = $${dateIdx})`,
      );
    }

    if (query.action && query.action !== 'all') {
      params.push(query.action);
      const idx = params.length;
      conditions.push(`a.action = $${idx}`);
    }

    if (query.q && query.q.trim()) {
      const escaped = query.q.trim().replace(/[%_\\]/g, '\\$&');
      params.push(`%${escaped}%`);
      const idx = params.length;
      conditions.push(`(
        target.full_name ILIKE $${idx} ESCAPE '\\'
        OR target.registration_no ILIKE $${idx} ESCAPE '\\'
        OR u.full_name ILIKE $${idx} ESCAPE '\\'
        OR u.registration_no ILIKE $${idx} ESCAPE '\\'
        OR a.action ILIKE $${idx} ESCAPE '\\'
      )`);
    }

    const whereClause = conditions.join(' AND ');

    const baseFromAndJoins = `
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.user_id
      LEFT JOIN users target ON target.id = COALESCE(
        NULLIF(a.new_value->>'studentId', '')::bigint,
        CASE WHEN a.action = 'attendance.marked' THEN a.user_id ELSE NULL END
      )
      LEFT JOIN class_schedules s ON s.id = NULLIF(a.new_value->>'scheduleId', '')::bigint
    `;

    const countQuery = `
      SELECT COUNT(a.id)::int AS total
      ${baseFromAndJoins}
      WHERE ${whereClause}
    `;

    const dataParams = [...params, limit, offset];
    const limitIdx = dataParams.length - 1;
    const offsetIdx = dataParams.length;

    const dataQuery = `
      SELECT
        a.id,
        a.created_at AS "createdAt",
        a.action,
        a.affected_entity AS "affectedEntity",
        a.affected_record_id AS "affectedRecordId",
        a.previous_value AS "previousValue",
        a.new_value AS "newValue",
        u.id AS "userId",
        u.full_name AS "userName",
        u.registration_no AS "userRegistrationNo",
        u.role AS "userRole",
        target.id AS "studentId",
        target.full_name AS "studentName",
        target.registration_no AS "studentRegistrationNo",
        COALESCE(a.new_value->>'classDate', TO_CHAR(s.class_date, 'YYYY-MM-DD')) AS "classDate"
      ${baseFromAndJoins}
      WHERE ${whereClause}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const [[{ total }], rows] = await Promise.all([
      this.dataSource.query<Array<{ total: number }>>(countQuery, params),
      this.dataSource.query<Array<Record<string, unknown>>>(
        dataQuery,
        dataParams,
      ),
    ]);

    const items: ActivityItem[] = rows.map((row) => {
      const action = String(row.action);
      const prev = (row.previousValue as Record<string, unknown>) || null;
      const next = (row.newValue as Record<string, unknown>) || null;
      const userId = toNullableString(row.userId);
      const studentId = toNullableString(row.studentId);

      return {
        id: String(row.id),
        createdAt: (row.createdAt as Date).toISOString(),
        action,
        actionLabel: this.getActionLabel(action),
        affectedEntity: toNullableString(row.affectedEntity),
        affectedRecordId: toNullableString(row.affectedRecordId),
        classDate: toNullableString(row.classDate),
        user: userId
          ? {
              id: userId,
              fullName: (row.userName as string) ?? null,
              registrationNo: String(row.userRegistrationNo),
              role: String(row.userRole),
            }
          : null,
        student: studentId
          ? {
              id: studentId,
              fullName: (row.studentName as string) ?? null,
              registrationNo: String(row.studentRegistrationNo),
            }
          : null,
        details: this.buildDetails(action, prev, next),
        previousValue: prev,
        newValue: next,
      };
    });

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      module: {
        id: module.id,
        name: module.name,
      },
      data: items,
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  /** Resumen de métricas de actividad del módulo activo */
  async getSummary() {
    const { module, now, timeZone } = await this.context();

    const [stats] = await this.dataSource.query<
      Array<{
        total: number;
        marks: number;
        corrections: number;
        today: number;
      }>
    >(
      `SELECT
        COUNT(a.id)::int AS "total",
        COUNT(a.id) FILTER (WHERE a.action = 'attendance.marked')::int AS "marks",
        COUNT(a.id) FILTER (WHERE a.action = 'attendance.admin_corrected')::int AS "corrections",
        COUNT(a.id) FILTER (WHERE TO_CHAR(a.created_at AT TIME ZONE $2, 'YYYY-MM-DD') = $3)::int AS "today"
      FROM audit_logs a
      WHERE a.module_id = $1`,
      [module.id, timeZone, now.date],
    );

    return {
      module: {
        id: module.id,
        name: module.name,
      },
      today: now.date,
      totals: stats ?? { total: 0, marks: 0, corrections: 0, today: 0 },
    };
  }

  private getActionLabel(action: string): string {
    switch (action) {
      case 'attendance.marked':
        return 'Marca de asistencia';
      case 'attendance.admin_corrected':
        return 'Corrección administrativa';
      case 'module.activated':
        return 'Activación de módulo';
      case 'users.created':
        return 'Usuario creado';
      case 'users.updated':
        return 'Usuario modificado';
      case 'users.soft_deleted':
        return 'Usuario eliminado';
      case 'users.restored':
        return 'Usuario restaurado';
      default:
        return action;
    }
  }

  private buildDetails(
    action: string,
    prev: Record<string, unknown> | null,
    next: Record<string, unknown> | null,
  ): Record<string, unknown> {
    if (action === 'attendance.marked') {
      const rawStatus = next?.status as string | undefined;
      const statusLabel =
        rawStatus === 'present'
          ? 'Presente (Puntual)'
          : rawStatus === 'late'
            ? 'Presente (Atraso)'
            : 'Falta';
      return {
        status: rawStatus ?? 'present',
        statusLabel,
        markedAt: next?.markedAt ?? null,
      };
    }

    if (action === 'attendance.admin_corrected') {
      const prevStatus = prev?.status as string | undefined;
      const nextStatus = next?.status as string | undefined;
      const prevLabel = prevStatus === 'present' ? 'Presente' : 'Falta';
      const nextLabel = nextStatus === 'present' ? 'Presente' : 'Falta';
      const notes =
        (next?.notes as string) ||
        (prev?.notes as string) ||
        'Modificado por el administrador';

      return {
        previousStatus: prevStatus ?? null,
        previousStatusLabel: prevLabel,
        newStatus: nextStatus ?? null,
        newStatusLabel: nextLabel,
        notes,
      };
    }

    if (action === 'module.activated') {
      return {
        name: next?.name,
        studentsCount:
          (next?.students as Record<string, unknown>)?.total ?? null,
        schedulesCount:
          (next?.schedules as Record<string, unknown>)?.total ?? null,
      };
    }

    return next ?? prev ?? {};
  }

  private async context(): Promise<{
    module: Module;
    now: LocalNow;
    timeZone: string;
  }> {
    const module = await this.academicModules.getActiveModule();
    if (!module) throw new NotFoundException('No active module');
    const timeZone = process.env.APP_TIMEZONE || DEFAULT_TIMEZONE;
    return {
      module,
      now: nowInTimezone(timeZone),
      timeZone,
    };
  }
}
