import { BadGatewayException } from '@nestjs/common';

/** True when the inquiry provider failed (network, internal error) — not user input mismatch. */
export function isZohalServiceFailure(err: unknown): boolean {
  return err instanceof BadGatewayException;
}
