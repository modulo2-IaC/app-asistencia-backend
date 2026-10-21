import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { ActivitiesService } from './activities.service';
import { ListActivitiesDto } from './dto/list-activities.dto';

@ApiTags('Activities administration')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
@ApiForbiddenResponse({
  description: 'Only administrators can access activities',
})
@ApiNotFoundResponse({ description: 'No active module' })
@Roles(UserRole.ADMIN)
@Controller('admin/activities')
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Get()
  @ApiOperation({
    summary: 'List audit activities for the active module with filters (RF-10)',
    description:
      'Allows administrators to query the activity history of the active module, filtered by student or date.',
  })
  @ApiOkResponse({
    description: 'Paginated activities: { module, data, meta }',
  })
  listActivities(@Query() query: ListActivitiesDto) {
    return this.activitiesService.listActivities(query);
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Activity summary statistics for the active module',
  })
  @ApiOkResponse({
    description: 'Summary counts: { module, today, totals }',
  })
  getSummary() {
    return this.activitiesService.getSummary();
  }
}
