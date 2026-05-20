import { Inject, Injectable } from '@nestjs/common';
import type { CarrierAdapter, CarrierCode } from './types';
import { CARRIER_ADAPTERS } from './types';

@Injectable()
export class CarrierRegistry {
  constructor(@Inject(CARRIER_ADAPTERS) private readonly adapters: CarrierAdapter[]) {}

  all(): CarrierAdapter[] {
    return this.adapters;
  }

  byCode(code: CarrierCode): CarrierAdapter {
    const a = this.adapters.find((x) => x.code === code);
    if (!a) throw new Error(`Unknown carrier: ${code}`);
    return a;
  }

  forCodes(codes: CarrierCode[]): CarrierAdapter[] {
    const wanted = new Set(codes);
    return this.adapters.filter((a) => wanted.has(a.code));
  }
}
