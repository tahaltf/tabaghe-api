/** 1 = pending, 2 = approved, 3 = rejected */
export type SmsIrTemplateStatus = 1 | 2 | 3;

export interface SmsIrApiResponse<T> {
  status?: number;
  message?: string;
  data?: T;
}

export interface SmsIrTemplate {
  id: number;
  title: string;
  templateText: string;
  status: SmsIrTemplateStatus;
  createDate?: string;
  updateDate?: string;
}

export interface SmsIrTemplatesPage {
  items: SmsIrTemplate[];
  totalCount?: number;
  pageNumber?: number;
  pageSize?: number;
}
