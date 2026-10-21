import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { AttendanceService } from './attendance.service';
import { MarkAttendanceDto } from './dto/mark-attendance.dto';
import { AttendanceHistoryQueryDto } from './dto/attendance-history-query.dto';
import { AdminCorrectAttendanceDto } from './dto/admin-correct-attendance.dto';

@ApiTags('Attendance')
@ApiBearerAuth('access-token')
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get('today')
  @ApiOperation({
    summary:
      'Obtener las clases programadas del día actual para el estudiante autenticado',
  })
  @ApiResponse({
    status: 200,
    description:
      'Lista de clases de hoy con estado de elegibilidad para marcar',
  })
  async getTodayClasses(@CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.getTodayClasses(user.id);
  }

  @Post('mark')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Marcar asistencia en la fecha y hora de la clase programada (RF-03)',
  })
  @ApiResponse({
    status: 200,
    description: 'Asistencia registrada exitosamente',
  })
  @ApiResponse({ status: 400, description: 'Fuera de horario o fecha' })
  @ApiResponse({ status: 409, description: 'Asistencia ya registrada' })
  async markAttendance(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MarkAttendanceDto,
  ) {
    return this.attendanceService.markAttendance(user.id, dto.scheduleId);
  }

  @Get('history')
  @ApiOperation({
    summary:
      'Historial de clases y asistencias agrupadas por módulo para el estudiante autenticado',
  })
  @ApiResponse({
    status: 200,
    description: 'Historial y estadísticas de asistencia por módulo',
  })
  async getHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AttendanceHistoryQueryDto,
  ) {
    return this.attendanceService.getHistory(user.id, query.moduleId);
  }

  @Post('admin/correct')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary:
      'Permite al administrador corregir o registrar una asistencia fuera de fecha (RF-04 / RN-06)',
  })
  @ApiResponse({
    status: 200,
    description: 'Asistencia corregida exitosamente',
  })
  async adminCorrect(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AdminCorrectAttendanceDto,
  ) {
    return this.attendanceService.adminCorrectAttendance(
      user.id,
      dto.studentId,
      dto.scheduleId,
      dto.status,
      dto.notes,
    );
  }
}
