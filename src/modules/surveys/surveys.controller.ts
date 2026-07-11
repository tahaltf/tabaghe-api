import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SurveysService } from './surveys.service';
import { SubmitSurveyDto } from './dto/submit-survey.dto';

@Controller('surveys')
export class SurveysController {
  constructor(private readonly surveys: SurveysService) {}

  @Get(':token')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  get(@Param('token') token: string) {
    return this.surveys.getByToken(token);
  }

  @Post(':token')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  submit(@Param('token') token: string, @Body() dto: SubmitSurveyDto) {
    return this.surveys.submitByToken(token, dto);
  }
}
