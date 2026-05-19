var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var AllExceptionsFilter_1;
import { Catch, HttpException, Logger, } from '@nestjs/common';
let AllExceptionsFilter = AllExceptionsFilter_1 = class AllExceptionsFilter {
    logger = new Logger(AllExceptionsFilter_1.name);
    catch(exception, host) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();
        const request = ctx.getRequest();
        const isHttp = exception instanceof HttpException;
        const status = isHttp ? exception.getStatus() : 500;
        const errorResponse = isHttp ? exception.getResponse() : null;
        const body = {
            code: typeof errorResponse === 'object'
                ? (errorResponse.code ?? 'INTERNAL_ERROR')
                : 'INTERNAL_ERROR',
            message: typeof errorResponse === 'string'
                ? errorResponse
                : (errorResponse?.message ?? 'Internal server error'),
            timestamp: new Date().toISOString(),
            path: request.url,
        };
        if (!isHttp) {
            this.logger.error(`Unhandled exception: ${exception}`, exception.stack);
        }
        response.status(status).json(body);
    }
};
AllExceptionsFilter = AllExceptionsFilter_1 = __decorate([
    Catch()
], AllExceptionsFilter);
export { AllExceptionsFilter };
//# sourceMappingURL=http-exception.filter.js.map