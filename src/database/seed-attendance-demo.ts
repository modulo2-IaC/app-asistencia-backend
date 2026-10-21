import 'dotenv/config';
import dataSource from './data-source';
import { Module } from './entities/module.entity';
import { ClassSchedule } from './entities/class-schedule.entity';
import { Enrollment } from './entities/enrollment.entity';
import { Attendance, AttendanceStatus } from './entities/attendance.entity';
import { AuditLog } from './entities/audit-log.entity';
import { User, UserRole } from '../modules/users/entities/user.entity';

/**
 * Seeder profesional para limpiar materias universitarias antiguas y establecer
 * la estructura académica de MÓDULOS DE DIPLOMADO (RN-01, RN-08, RF-03, RF-04, RF-05).
 *
 * Estructura académica: Diplomado en Desarrollo Full Stack Cloud & DevOps
 * - Módulo 1 (Histórico): Arquitectura de Software Cloud Native y Microservicios (Julio 2026)
 * - Módulo 2 (Histórico): Ingeniería Backend con NestJS y Bases de Datos Escalables (Agosto 2026)
 * - Módulo 3 (Histórico): Desarrollo Frontend Moderno con React y TypeScript (Septiembre 2026)
 * - Módulo 4 (Activo):    DevOps, CI/CD y Contenedores con Kubernetes (Octubre 2026)
 */
async function seedDiplomaModules(): Promise<void> {
  await dataSource.initialize();
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();

  try {
    console.info(
      '🚀 Iniciando sincronización de Módulos de Diplomado y Asistencias...',
    );

    const userRepo = dataSource.getRepository(User);
    const moduleRepo = dataSource.getRepository(Module);
    const scheduleRepo = dataSource.getRepository(ClassSchedule);
    const enrollmentRepo = dataSource.getRepository(Enrollment);
    const attendanceRepo = dataSource.getRepository(Attendance);
    const auditRepo = dataSource.getRepository(AuditLog);

    // =========================================================================
    // PASO 1: ELIMINACIÓN DE MATERIAS ANTIGUAS Y REGISTROS ASOCIADOS
    // =========================================================================
    console.info(
      '🧹 Paso 1: Buscando y eliminando materias universitarias obsoletas...',
    );
    const legacyPatterns = [
      '%Sistemas Operativos%',
      '%Base de Datos II%',
      '%Redes de Computadoras%',
    ];

    const oldModules = await moduleRepo
      .createQueryBuilder('module')
      .where('module.name ILIKE ANY(:patterns)', { patterns: legacyPatterns })
      .orWhere('module.id IN (:...legacyIds)', { legacyIds: ['1', '2', '3'] })
      .getMany();

    if (oldModules.length > 0) {
      const oldModuleIds = oldModules.map((m) => m.id);
      console.info(
        `   Se encontraron ${oldModules.length} registros obsoletos:`,
        oldModules.map((m) => `${m.id}: ${m.name}`),
      );

      // 1. Limpiar auditoría asociada a los módulos antiguos
      await auditRepo
        .createQueryBuilder()
        .delete()
        .where('moduleId IN (:...oldModuleIds)', { oldModuleIds })
        .execute();

      // 2. Obtener inscripciones y horarios para borrar asistencias
      const oldEnrollments = await enrollmentRepo
        .createQueryBuilder('e')
        .where('e.moduleId IN (:...oldModuleIds)', { oldModuleIds })
        .getMany();

      const oldSchedules = await scheduleRepo
        .createQueryBuilder('s')
        .where('s.moduleId IN (:...oldModuleIds)', { oldModuleIds })
        .getMany();

      if (oldEnrollments.length > 0 || oldSchedules.length > 0) {
        const enrIds = oldEnrollments.map((e) => e.id);
        const schedIds = oldSchedules.map((s) => s.id);

        const deleteAttQuery = attendanceRepo.createQueryBuilder().delete();
        if (enrIds.length > 0 && schedIds.length > 0) {
          deleteAttQuery.where(
            'enrollmentId IN (:...enrIds) OR scheduleId IN (:...schedIds)',
            { enrIds, schedIds },
          );
        } else if (enrIds.length > 0) {
          deleteAttQuery.where('enrollmentId IN (:...enrIds)', { enrIds });
        } else {
          deleteAttQuery.where('scheduleId IN (:...schedIds)', { schedIds });
        }
        await deleteAttQuery.execute();
      }

      // 3. Eliminar horarios e inscripciones
      if (oldSchedules.length > 0) {
        await scheduleRepo
          .createQueryBuilder()
          .delete()
          .where('moduleId IN (:...oldModuleIds)', { oldModuleIds })
          .execute();
      }

      if (oldEnrollments.length > 0) {
        await enrollmentRepo
          .createQueryBuilder()
          .delete()
          .where('moduleId IN (:...oldModuleIds)', { oldModuleIds })
          .execute();
      }

      // 4. Eliminar las materias de la tabla modules
      await moduleRepo
        .createQueryBuilder()
        .delete()
        .where('id IN (:...oldModuleIds)', { oldModuleIds })
        .execute();

      console.info(
        '   ✅ Materias antiguas y sus dependencias eliminadas con éxito.',
      );
    } else {
      console.info(
        '   ℹ️ No se detectaron materias antiguas pendientes de eliminación.',
      );
    }

    // =========================================================================
    // PASO 2: OBTENER ESTUDIANTES PARA INSCRIPCIÓN
    // =========================================================================
    const students = await userRepo.find({
      where: { role: UserRole.STUDENT },
      order: { id: 'ASC' },
    });

    if (students.length === 0) {
      console.warn('⚠️ No se encontraron estudiantes en la base de datos.');
      return;
    }
    console.info(
      `👥 Estudiantes encontrados para asignación: ${students.length} (${students.map((s) => s.registrationNo).join(', ')})`,
    );

    // =========================================================================
    // PASO 3: CREAR LOS 3 MÓDULOS HISTÓRICOS DEL DIPLOMADO (is_active: false)
    // =========================================================================
    console.info(
      '📚 Paso 2: Creando 3 módulos históricos del diplomado con sus fechas pasadas...',
    );

    interface HistoricalModuleDef {
      name: string;
      schedules: Array<{
        date: string;
        start: string;
        grace: string;
        end: string;
      }>;
      // Patrón de asistencia para los estudiantes (P = present, L = late, A = absent)
      studentAttendancePattern: Array<'present' | 'late' | 'absent'>;
    }

    const historicalDefs: HistoricalModuleDef[] = [
      {
        name: 'Módulo 1: Arquitectura de Software Cloud Native y Microservicios',
        schedules: [
          {
            date: '2026-07-06',
            start: '19:00:00',
            grace: '19:15:00',
            end: '22:00:00',
          },
          {
            date: '2026-07-08',
            start: '19:00:00',
            grace: '19:15:00',
            end: '22:00:00',
          },
          {
            date: '2026-07-10',
            start: '19:00:00',
            grace: '19:15:00',
            end: '22:00:00',
          },
          {
            date: '2026-07-13',
            start: '19:00:00',
            grace: '19:15:00',
            end: '22:00:00',
          },
          {
            date: '2026-07-15',
            start: '19:00:00',
            grace: '19:15:00',
            end: '22:00:00',
          },
          {
            date: '2026-07-17',
            start: '19:00:00',
            grace: '19:15:00',
            end: '22:00:00',
          },
          {
            date: '2026-07-20',
            start: '19:00:00',
            grace: '19:15:00',
            end: '22:00:00',
          },
          {
            date: '2026-07-22',
            start: '19:00:00',
            grace: '19:15:00',
            end: '22:00:00',
          },
        ],
        studentAttendancePattern: [
          'present',
          'present',
          'present',
          'late',
          'present',
          'present',
          'present',
          'present',
        ],
      },
      {
        name: 'Módulo 2: Ingeniería Backend con NestJS y Bases de Datos Escalables',
        schedules: [
          {
            date: '2026-08-03',
            start: '19:00:00',
            grace: '19:15:00',
            end: '22:00:00',
          },
          {
            date: '2026-08-05',
            start: '19:00:00',
            grace: '19:15:00',
            end: '22:00:00',
          },
          {
            date: '2026-08-07',
            start: '19:00:00',
            grace: '19:15:00',
            end: '22:00:00',
          },
          {
            date: '2026-08-10',
            start: '19:00:00',
            grace: '19:15:00',
            end: '22:00:00',
          },
          {
            date: '2026-08-12',
            start: '19:00:00',
            grace: '19:15:00',
            end: '22:00:00',
          },
          {
            date: '2026-08-14',
            start: '19:00:00',
            grace: '19:15:00',
            end: '22:00:00',
          },
          {
            date: '2026-08-17',
            start: '19:00:00',
            grace: '19:15:00',
            end: '22:00:00',
          },
          {
            date: '2026-08-19',
            start: '19:00:00',
            grace: '19:15:00',
            end: '22:00:00',
          },
        ],
        studentAttendancePattern: [
          'present',
          'present',
          'absent',
          'present',
          'present',
          'late',
          'present',
          'present',
        ],
      },
      {
        name: 'Módulo 3: Desarrollo Frontend Moderno con React, TypeScript y Tailwind',
        schedules: [
          {
            date: '2026-09-07',
            start: '19:00:00',
            grace: '19:15:00',
            end: '22:00:00',
          },
          {
            date: '2026-09-09',
            start: '19:00:00',
            grace: '19:15:00',
            end: '22:00:00',
          },
          {
            date: '2026-09-11',
            start: '19:00:00',
            grace: '19:15:00',
            end: '22:00:00',
          },
          {
            date: '2026-09-14',
            start: '19:00:00',
            grace: '19:15:00',
            end: '22:00:00',
          },
          {
            date: '2026-09-16',
            start: '19:00:00',
            grace: '19:15:00',
            end: '22:00:00',
          },
          {
            date: '2026-09-18',
            start: '19:00:00',
            grace: '19:15:00',
            end: '22:00:00',
          },
          {
            date: '2026-09-21',
            start: '19:00:00',
            grace: '19:15:00',
            end: '22:00:00',
          },
          {
            date: '2026-09-23',
            start: '19:00:00',
            grace: '19:15:00',
            end: '22:00:00',
          },
        ],
        studentAttendancePattern: [
          'present',
          'present',
          'present',
          'present',
          'absent',
          'present',
          'present',
          'late',
        ],
      },
    ];

    for (const hDef of historicalDefs) {
      let mod = await moduleRepo.findOne({ where: { name: hDef.name } });
      if (!mod) {
        mod = await moduleRepo.save(
          moduleRepo.create({
            name: hDef.name,
            isActive: false, // Histórico concluido
          }),
        );
      } else if (mod.isActive) {
        mod.isActive = false;
        await moduleRepo.save(mod);
      }

      // Inscribir estudiantes
      const enrolledStudents: { student: User; enrollment: Enrollment }[] = [];
      for (const student of students) {
        let enr = await enrollmentRepo.findOne({
          where: { studentId: student.id, moduleId: mod.id },
        });
        if (!enr) {
          enr = await enrollmentRepo.save(
            enrollmentRepo.create({
              studentId: student.id,
              moduleId: mod.id,
            }),
          );
        }
        enrolledStudents.push({ student, enrollment: enr });
      }

      // Crear clases y asistencias pasadas
      for (let i = 0; i < hDef.schedules.length; i++) {
        const item = hDef.schedules[i];
        let sched = await scheduleRepo.findOne({
          where: {
            moduleId: mod.id,
            classDate: item.date,
            startTime: item.start,
          },
        });
        if (!sched) {
          sched = await scheduleRepo.save(
            scheduleRepo.create({
              moduleId: mod.id,
              classDate: item.date,
              startTime: item.start,
              graceTime: item.grace,
              endTime: item.end,
            }),
          );
        }

        const expectedStatus = hDef.studentAttendancePattern[i] ?? 'present';

        for (const { enrollment } of enrolledStudents) {
          const existingAtt = await attendanceRepo.findOne({
            where: { enrollmentId: enrollment.id, scheduleId: sched.id },
          });

          if (!existingAtt && expectedStatus !== 'absent') {
            // Generar marca realista
            const minutesOffset =
              expectedStatus === 'present'
                ? Math.floor(Math.random() * 8) + 2
                : 18;
            const formattedMinutes =
              minutesOffset < 10 ? `0${minutesOffset}` : `${minutesOffset}`;
            const markedDate = new Date(
              `${item.date}T19:${formattedMinutes}:12-04:00`,
            );

            await attendanceRepo.save(
              attendanceRepo.create({
                enrollmentId: enrollment.id,
                scheduleId: sched.id,
                status:
                  expectedStatus === 'present'
                    ? AttendanceStatus.PRESENT
                    : AttendanceStatus.LATE,
                markedAt: markedDate,
                notes:
                  expectedStatus === 'present'
                    ? 'Asistencia registrada en horario'
                    : 'Registro con atraso justificado',
              }),
            );
          }
          // Si es absent, no se crea registro de asistencia o se omite para que RF-04 calcule automáticamente "Falta"
        }
      }

      console.info(`   ✅ ${hDef.name}: 8 clases y asistencias sincronizadas.`);
    }

    // =========================================================================
    // PASO 4: CONFIGURAR EL MÓDULO ACTIVO ACTUAL (MÓDULO 4)
    // =========================================================================
    console.info(
      '⚡ Paso 3: Configurando Módulo 4 como módulo activo del diplomado...',
    );
    const now = new Date();
    const todayDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/La_Paz',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);

    let activeMod = await moduleRepo.findOne({ where: { isActive: true } });
    const activeModName =
      'Módulo 4: DevOps, CI/CD y Contenedores con Kubernetes';

    if (!activeMod) {
      activeMod = await moduleRepo.save(
        moduleRepo.create({
          name: activeModName,
          isActive: true,
        }),
      );
    } else {
      activeMod.name = activeModName;
      await moduleRepo.save(activeMod);
    }

    // Inscribir todos los estudiantes en el módulo activo
    for (const student of students) {
      const existingEnr = await enrollmentRepo.findOne({
        where: { studentId: student.id, moduleId: activeMod.id },
      });
      if (!existingEnr) {
        await enrollmentRepo.save(
          enrollmentRepo.create({
            studentId: student.id,
            moduleId: activeMod.id,
          }),
        );
      }
    }

    // Clase de HOY (en curso para probar RF-03 inmediatamente)
    // De 07:00 a 23:59 para que durante toda la jornada de hoy esté activa y habilitada para marcar
    const todaySched = await scheduleRepo.findOne({
      where: { moduleId: activeMod.id, classDate: todayDate },
    });
    if (!todaySched) {
      await scheduleRepo.save(
        scheduleRepo.create({
          moduleId: activeMod.id,
          classDate: todayDate,
          startTime: '07:00:00',
          graceTime: '23:30:00',
          endTime: '23:59:00',
        }),
      );
    } else {
      todaySched.startTime = '07:00:00';
      todaySched.graceTime = '23:30:00';
      todaySched.endTime = '23:59:00';
      await scheduleRepo.save(todaySched);
    }

    // Próximas clases para la próxima semana (19, 21 y 23 de octubre de 2026)
    const upcomingSchedules = [
      {
        date: '2026-10-19',
        start: '19:00:00',
        grace: '19:15:00',
        end: '22:00:00',
      },
      {
        date: '2026-10-21',
        start: '19:00:00',
        grace: '19:15:00',
        end: '22:00:00',
      },
      {
        date: '2026-10-23',
        start: '19:00:00',
        grace: '19:15:00',
        end: '22:00:00',
      },
    ];

    for (const up of upcomingSchedules) {
      const upSched = await scheduleRepo.findOne({
        where: {
          moduleId: activeMod.id,
          classDate: up.date,
          startTime: up.start,
        },
      });
      if (!upSched) {
        await scheduleRepo.save(
          scheduleRepo.create({
            moduleId: activeMod.id,
            classDate: up.date,
            startTime: up.start,
            graceTime: up.grace,
            endTime: up.end,
          }),
        );
      }
    }

    console.info(
      `   ✅ Módulo activo "${activeMod.name}" configurado con clase de hoy (${todayDate}) y próximas clases para la semana entrante.`,
    );

    console.info(
      '🎉 ¡Seeding completado con éxito! Todos los módulos y asistencias están listos y normalizados.',
    );
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
}

void seedDiplomaModules().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : 'Error desconocido durante la ejecución del seeder';
  console.error('❌ Error en el seeder:', message);
  process.exitCode = 1;
});
