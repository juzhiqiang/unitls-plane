var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable, UnauthorizedException, } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { auth } from '@utils-plane/auth';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
let AuthGuard = class AuthGuard {
    reflector;
    constructor(reflector) {
        this.reflector = reflector;
    }
    async canActivate(context) {
        const isPublic = this.reflector.getAllAndOverride(IS_PUBLIC_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        const request = context.switchToHttp().getRequest();
        // Convert express headers to Headers object
        const headers = new Headers();
        for (const [key, value] of Object.entries(request.headers)) {
            if (typeof value === 'string') {
                headers.set(key, value);
            }
        }
        const session = await auth.api.getSession({ headers });
        if (!session) {
            if (isPublic)
                return true;
            throw new UnauthorizedException('Not authenticated');
        }
        request.user = session.user;
        request.session = session.session;
        return true;
    }
};
AuthGuard = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [Reflector])
], AuthGuard);
export { AuthGuard };
//# sourceMappingURL=auth.guard.js.map