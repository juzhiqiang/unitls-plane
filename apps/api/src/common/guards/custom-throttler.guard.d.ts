import { ThrottlerGuard } from '@nestjs/throttler';
export declare class CustomThrottlerGuard extends ThrottlerGuard {
    protected getTracker(req: any): Promise<string>;
}
//# sourceMappingURL=custom-throttler.guard.d.ts.map