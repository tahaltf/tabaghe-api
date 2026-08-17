/** Per Zohal API: 1 success, 4 invalid request, 5 internal error, 6 bad input. */
export const ZOHAL_RESULT = {
  SUCCESS: 1,
  INVALID: 4,
  INTERNAL_ERROR: 5,
  BAD_INPUT: 6,
} as const;

/** error_code values from the implementation guide (intro table + per-endpoint 400s). */
export const ZOHAL_ERROR_CODE = {
  INVALID: 'INVALID',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  SERVICE_NOT_FOUND: 'SERVICE_NOT_FOUND',
} as const;

export type ZohalInquiryPath =
  | 'inquiry/shahkar'
  | 'inquiry/national_identity_inquiry'
  | 'inquiry/postal_code_inquiry'
  | 'inquiry/check_card_with_national_code';

export type ZohalEnvelope<T> = {
  result: number;
  response_body: {
    data: T;
    error_code: string | null;
    message: string;
  };
};

export type ZohalShahkarData = {
  matched?: boolean;
};

export type ZohalNationalIdentityData = {
  matched?: boolean;
  alive?: boolean | null;
  is_dead?: boolean | null;
  father_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  national_code?: string | null;
};

export type ZohalPostalAddress = {
  province?: string | null;
  town?: string | null;
  district?: string | null;
  street?: string | null;
  street2?: string | null;
  number?: string | number | null;
  floor?: string | null;
  side_floor?: string | null;
  building_name?: string | null;
  description?: string | null;
};

export type ZohalPostalCodeData = {
  address?: ZohalPostalAddress | null;
};

export type ZohalMatchedData = {
  matched?: boolean;
};

export type PostalInquiryResult = {
  province: string;
  city: string;
  district: string;
  fullAddress: string;
  raw: ZohalPostalAddress;
};

export type IdentityInquiryResult = {
  firstName: string;
  lastName: string;
  fatherName: string | null;
  alive: boolean;
  isDead: boolean | null;
  nationalCode: string;
  raw: ZohalNationalIdentityData;
};
