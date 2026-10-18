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
  type?: number;
  parameters?: Array<{ name: string; description?: string }>;
}

export interface SmsIrTemplatesPage {
  items: SmsIrTemplate[];
  totalCount?: number;
  pageNumber?: number;
  pageSize?: number;
}

export interface SmsIrSendBulkResult {
  packId: string;
  messageIds: number[];
  cost: number;
}

export interface SmsIrVerifyResult {
  messageId: number;
  cost: number;
}

export interface SmsIrVerifyParameter {
  name: string;
  value: string;
}

export interface SmsIrMessageReport {
  messageId: number;
  mobile: number | string;
  messageText: string;
  sendDateTime: number;
  lineNumber: number | string;
  cost: number;
  deliveryState: number | null;
  deliveryDateTime: number | null;
}

export interface SmsIrPackSummary {
  packId: string;
  recipientCount: number;
  creationDateTime: number;
}

export interface SmsIrReceivedMessage {
  receiveReturnId?: number;
  messageText: string;
  number: number | string;
  mobile: number | string;
  receivedDateTime: number;
}

export interface SmsIrPageParams {
  pageNumber?: number;
  pageSize?: number;
}

export interface SmsIrArchiveParams extends SmsIrPageParams {
  fromDate?: number;
  toDate?: number;
}

export interface SmsIrReceiveLiveParams extends SmsIrPageParams {
  sortByNewest?: boolean;
  mobile?: string;
}

export interface SmsIrReceiveArchiveParams extends SmsIrArchiveParams {
  sortByNewest?: boolean;
}
