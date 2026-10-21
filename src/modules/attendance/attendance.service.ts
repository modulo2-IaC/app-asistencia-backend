import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import {
  Attendance,
  AttendanceStatus,
} from '../../database/entities/attendance.entity';
import { ClassSchedule } from '../../database/entities/class-schedule.entity';
import { Enrollment } from '../../database/entities/enrollment.entity';
import { Module } from '../../database/entities/module.entity';
import { AuditLog } from '../../database/entities/audit-log.entity';
import {
  effectiveStatus,
  EffectiveStatus,
} from '../../common/attendance-status';
import { DEFAULT_TIMEZONE, nowInTimezone } from '../../common/clock';
import { AcademicModulesService } from '../academic-modules/academic-modules.service';
import { UserRole } from '../users/entities/user.entity';
import { CorrectableStatus } from './dto/admin-correct-attendance.dto';

const REQUESTED_STATUS: Record<CorrectableStatus, EffectiveStatus> = {
  [AttendanceStatus.PRESENT]: 'present',
  [AttendanceStatus.LATE]: 'late',
  [AttendanceStatus.ABSENT]: 'absent',
};

@Injectable()
export class AttendanceService {
  constructor(
    @InjectRepository(Attendance)
    private readonly attendanceRepo: Repository<Attendance>,
    @InjectRepository(ClassSchedule)
    private readonly scheduleRepo: Repository<ClassSchedule>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepo: Repository<Enrollment>,
    @InjectRepository(Module)
    private readonly moduleRepo: Repository<Module>,
    private readonly dataSource: DataSource,
    private readonly academicModules: AcademicModulesService,
    private readonly configService: ConfigService,
  ) {}

  private getBoliviaDateTime(): { date: string; time: string; full: Date } {
    const now = new Date();
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/La_Paz',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);

    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/La_Paz',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(now);

    return { date, time, full: now };
  }

  async getTodayClasses(studentId: string) {
    const { date: todayDate, time: currentTime } = this.getBoliviaDateTime();

    const enrollments = await this.enrollmentRepo.find({
      where: { studentId },
      relations: { module: true },
    });

    if (enrollments.length === 0) {
      return {
        currentDate: todayDate,
        currentTime,
        classes: [],
      };
    }

    const moduleMap = new Map(enrollments.map((e) => [e.moduleId, e]));
    const moduleIds = enrollments.map((e) => e.moduleId);

    const schedules = await this.scheduleRepo
      .createQueryBuilder('schedule')
      .where('schedule.moduleId IN (:...moduleIds)', { moduleIds })
      .andWhere('schedule.classDate = :todayDate', { todayDate })
      .orderBy('schedule.startTime', 'ASC')
      .getMany();

    const scheduleIds = schedules.map((s) => s.id);
    const attendances =
      scheduleIds.length > 0
        ? await this.attendanceRepo
            .createQueryBuilder('att')
            .where('att.scheduleId IN (:...scheduleIds)', { scheduleIds })
            .andWhere('att.enrollmentId IN (:...enrollmentIds)', {
              enrollmentIds: enrollments.map((e) => e.id),
            })
            .getMany()
        : [];

    const attendanceMap = new Map(
      attendances.map((a) => [`${a.enrollmentId}_${a.scheduleId}`, a]),
    );

    const classes = schedules.map((schedule) => {
      const enrollment = moduleMap.get(schedule.moduleId)!;
      const attendance =
        attendanceMap.get(`${enrollment.id}_${schedule.id}`) || null;

      const isClassTime =
        currentTime >= schedule.startTime && currentTime <= schedule.endTime;
      const isPast = currentTime > schedule.endTime;
      const isFuture = currentTime < schedule.startTime;
      const hasMarked = Boolean(attendance);
      const canMark = isClassTime && !hasMarked;

      let statusMessage = 'Disponible para marcar';
      if (hasMarked) {
        statusMessage =
          attendance?.status === AttendanceStatus.PRESENT
            ? 'Asistencia registrada (Puntual)'
            : 'Asistencia registrada (Atraso)';
      } else if (isFuture) {
        statusMessage = `La clase inicia a las ${schedule.startTime.slice(0, 5)}`;
      } else if (isPast) {
        statusMessage = 'El horario de la clase ha finalizado';
      }

      return {
        scheduleId: schedule.id,
        enrollmentId: enrollment.id,
        moduleId: schedule.moduleId,
        moduleName: enrollment.module?.name ?? 'Módulo',
        classDate: schedule.classDate,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        graceTime: schedule.graceTime,
        currentTime,
        isClassTime,
        isPast,
        isFuture,
        hasMarked,
        canMark,
        statusMessage,
        attendance: attendance
          ? {
              id: attendance.id,
              status: attendance.status,
              markedAt: attendance.markedAt,
              notes: attendance.notes,
            }
          : null,
      };
    });

    return {
      currentDate: todayDate,
      currentTime,
      classes,
    };
  }

  async markAttendance(studentId: string, scheduleId: string) {
    const {
      date: todayDate,
      time: currentTime,
      full: realTimestamp,
    } = this.getBoliviaDateTime();

    const schedule = await this.scheduleRepo.findOne({
      where: { id: scheduleId },
      relations: { module: true },
    });

    if (!schedule) {
      throw new NotFoundException('La clase programada no fue encontrada');
    }

    const enrollment = await this.enrollmentRepo.findOne({
      where: {
        studentId,
        moduleId: schedule.moduleId,
      },
      relations: { student: true },
    });

    if (!enrollment) {
      throw new ForbiddenException(
        'El estudiante no se encuentra inscrito en este módulo',
      );
    }

    const existingAttendance = await this.attendanceRepo.findOne({
      where: {
        enrollmentId: enrollment.id,
        scheduleId: schedule.id,
      },
    });

    if (existingAttendance) {
      throw new ConflictException(
        'Solo se admite una marca de asistencia por estudiante y fecha de clase',
      );
    }

    if (schedule.classDate !== todayDate) {
      throw new BadRequestException(
        `Fuera de la fecha programada. La clase corresponde a la fecha ${schedule.classDate}.`,
      );
    }

    if (currentTime < schedule.startTime) {
      throw new BadRequestException(
        `La clase aún no ha iniciado. Horario de inicio: ${schedule.startTime}`,
      );
    }

    if (currentTime > schedule.endTime) {
      throw new BadRequestException(
        `El horario de clase ha concluido. Horario de fin: ${schedule.endTime}`,
      );
    }

    const status =
      currentTime <= schedule.graceTime
        ? AttendanceStatus.PRESENT
        : AttendanceStatus.LATE;

    return await this.dataSource.transaction(async (manager) => {
      const attRepo = manager.getRepository(Attendance);
      const auditRepo = manager.getRepository(AuditLog);

      const record = attRepo.create({
        enrollmentId: enrollment.id,
        scheduleId: schedule.id,
        status,
        markedAt: realTimestamp,
        notes: `Marcado automáticamente (${status === AttendanceStatus.PRESENT ? 'Puntual' : 'Atraso'}) a las ${currentTime}`,
      });

      const savedAttendance = await attRepo.save(record);

      await auditRepo.save(
        auditRepo.create({
          userId: studentId,
          moduleId: schedule.moduleId,
          action: 'attendance.marked',
          affectedEntity: 'attendance',
          affectedRecordId: savedAttendance.id,
          previousValue: null,
          newValue: {
            id: savedAttendance.id,
            enrollmentId: enrollment.id,
            scheduleId: schedule.id,
            classDate: schedule.classDate,
            studentId,
            registrationNo: enrollment.student?.registrationNo ?? null,
            studentName: enrollment.student?.fullName ?? null,
            status,
            markedAt: realTimestamp,
          },
        }),
      );

      return {
        message:
          status === AttendanceStatus.PRESENT
            ? 'Asistencia marcada con éxito (Puntual)'
            : 'Asistencia marcada con éxito (Con retraso)',
        attendance: savedAttendance,
      };
    });
  }

  async getHistory(studentId: string, filterModuleId?: string) {
    const { date: todayDate, time: currentTime } = this.getBoliviaDateTime();

    const enrollments = await this.enrollmentRepo.find({
      where: { studentId },
      relations: { module: true },
    });

    if (enrollments.length === 0) {
      return { modules: [] };
    }

    const filteredEnrollments = filterModuleId
      ? enrollments.filter((e) => e.moduleId === filterModuleId)
      : enrollments;

    const results: any[] = [];

    for (const enrollment of filteredEnrollments) {
      const schedules = await this.scheduleRepo.find({
        where: { moduleId: enrollment.moduleId },
        order: { classDate: 'DESC', startTime: 'DESC' },
      });

      const scheduleIds = schedules.map((s) => s.id);
      const attendances =
        scheduleIds.length > 0
          ? await this.attendanceRepo
              .createQueryBuilder('att')
              .where('att.scheduleId IN (:...scheduleIds)', { scheduleIds })
              .andWhere('att.enrollmentId = :enrollmentId', {
                enrollmentId: enrollment.id,
              })
              .getMany()
          : [];

      const attMap = new Map(attendances.map((a) => [a.scheduleId, a]));

      let presentCount = 0;
      let lateCount = 0;
      let absentCount = 0;
      let pendingCount = 0;

      const historyClasses = schedules.map((schedule) => {
        const att = attMap.get(schedule.id) || null;
        let finalStatus: string;

        if (att) {
          finalStatus = att.status;
          if (att.status === AttendanceStatus.PRESENT) presentCount++;
          else if (att.status === AttendanceStatus.LATE) lateCount++;
          else if (att.status === AttendanceStatus.EXCUSED) presentCount++;
          else absentCount++;
        } else {
          const isPassed =
            schedule.classDate < todayDate ||
            (schedule.classDate === todayDate &&
              currentTime > schedule.endTime);

          if (isPassed) {
            finalStatus = 'absent';
            absentCount++;
          } else {
            finalStatus = 'pending';
            pendingCount++;
          }
        }

        return {
          scheduleId: schedule.id,
          classDate: schedule.classDate,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          graceTime: schedule.graceTime,
          status: finalStatus,
          markedAt: att?.markedAt ?? null,
          notes: att?.notes ?? null,
        };
      });

      const evaluatedTotal = presentCount + lateCount + absentCount;
      const percentage =
        evaluatedTotal > 0
          ? Math.round(((presentCount + lateCount) / evaluatedTotal) * 100)
          : 100;

      results.push({
        moduleId: enrollment.moduleId,
        moduleName: enrollment.module?.name ?? 'Módulo',
        isActive: enrollment.module?.isActive ?? false,
        stats: {
          totalSchedules: schedules.length,
          evaluatedTotal,
          presentCount,
          lateCount,
          absentCount,
          pendingCount,
          attendancePercentage: percentage,
        },
        records: historyClasses,
      });
    }

    return { modules: results };
  }

  /**
   * RF-07: an administrator sets Present/Absent for a student on any class
   * date of the active module up to today. Every effective change is audited
   * with the previous and new values (RN-07); repeating the current status is
   * a no-op.
   */
  async adminCorrectAttendance(
    adminId: string,
    studentId: string,
    scheduleId: string,
    status: CorrectableStatus,
    notes?: string,
  ) {
    const activeModule = await this.academicModules.getActiveModule();
    if (!activeModule) {
      throw new NotFoundException('No hay un módulo activo');
    }

    const schedule = await this.scheduleRepo.findOne({
      where: { id: scheduleId, moduleId: activeModule.id },
    });
    if (!schedule) {
      throw new NotFoundException(
        'La clase programada no pertenece al módulo activo',
      );
    }

    const now = nowInTimezone(
      this.configService.get<string>('APP_TIMEZONE') ?? DEFAULT_TIMEZONE,
    );
    if (schedule.classDate > now.date) {
      throw new BadRequestException(
        'No se puede modificar la asistencia de una fecha futura',
      );
    }

    const enrollment = await this.enrollmentRepo.findOne({
      where: { studentId, moduleId: activeModule.id },
      relations: { student: true },
    });
    if (
      !enrollment?.student ||
      enrollment.student.deletedAt ||
      enrollment.student.role !== UserRole.STUDENT
    ) {
      throw new NotFoundException(
        'El estudiante no está inscrito en el módulo activo',
      );
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const attRepo = manager.getRepository(Attendance);
        const auditRepo = manager.getRepository(AuditLog);

        // Lock the row so concurrent corrections/marks cannot interleave.
        const existing = await attRepo.findOne({
          where: { enrollmentId: enrollment.id, scheduleId: schedule.id },
          lock: { mode: 'pessimistic_write' },
        });
        const previousStatus = effectiveStatus(
          existing?.status ?? null,
          schedule.classDate,
          schedule.endTime,
          now,
        );
        const requestedStatus: EffectiveStatus = REQUESTED_STATUS[status];
        if (previousStatus === requestedStatus) {
          return {
            message:
              'La asistencia ya tenía ese estado; no se realizaron cambios',
            unchanged: true,
            attendance: existing ? this.correctionView(existing) : null,
          };
        }

        const previousValue = {
          status: previousStatus,
          storedStatus: existing?.status ?? null,
          markedAt: existing?.markedAt ?? null,
          notes: existing?.notes ?? null,
        };
        const reason = notes?.trim() || 'Modificado por el administrador';

        const record =
          existing ??
          attRepo.create({
            enrollmentId: enrollment.id,
            scheduleId: schedule.id,
            markedAt: null,
          });
        record.status = status;
        record.notes = reason;
        // An absence has no mark time; a student's real mark time is kept for
        // presences and preserved in the audit trail otherwise.
        if (status === AttendanceStatus.ABSENT) record.markedAt = null;
        const saved = await attRepo.save(record);

        await auditRepo.save(
          auditRepo.create({
            userId: adminId,
            moduleId: activeModule.id,
            action: 'attendance.admin_corrected',
            affectedEntity: 'attendance',
            affectedRecordId: saved.id,
            previousValue,
            newValue: {
              status,
              notes: reason,
              studentId: enrollment.studentId,
              registrationNo: enrollment.student.registrationNo,
              studentName: enrollment.student.fullName,
              scheduleId: schedule.id,
              classDate: schedule.classDate,
            },
          }),
        );

        return {
          message: 'Asistencia actualizada correctamente',
          unchanged: false,
          attendance: this.correctionView(saved),
        };
      });
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { driverError?: { code?: string } })
          .driverError?.code === '23505'
      ) {
        throw new ConflictException(
          'La asistencia cambió mientras se guardaba; vuelve a intentarlo',
        );
      }
      throw error;
    }
  }

  private correctionView(record: Attendance) {
    return {
      id: record.id,
      status: record.status,
      markedAt: record.markedAt,
      notes: record.notes,
    };
  }
}
