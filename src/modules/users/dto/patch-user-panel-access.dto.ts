import { IsObject } from 'class-validator';

export class PatchUserPanelAccessDto {
  @IsObject()
  panelAccess!: Record<string, boolean>;
}
