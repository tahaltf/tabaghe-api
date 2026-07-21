import { SetMetadata } from '@nestjs/common';
import type { UserPanelAccessKey } from '../../users/config/user-panel-access.registry';

export const PANEL_ACCESS_KEY = 'panel_access';

export const RequirePanelAccess = (key: UserPanelAccessKey) =>
  SetMetadata(PANEL_ACCESS_KEY, key);
