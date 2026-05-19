var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import * as openapi from "@nestjs/swagger";
import { All, Controller, Req, Res } from '@nestjs/common';
import { auth } from '@utils-plane/auth';
import { Public } from '../../common/decorators/public.decorator';
let AuthController = class AuthController {
    async handle(req, res) {
        const baseUrl = `http://${req.headers.host}`;
        const url = new URL(req.url, baseUrl).toString();
        const headers = {};
        for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === 'string') {
                headers[key] = value;
            }
        }
        const request = new Request(url, {
            method: req.method,
            headers,
            body: ['GET', 'HEAD'].includes(req.method)
                ? undefined
                : JSON.stringify(req.body),
        });
        const response = await auth.handler(request);
        // Forward response
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.status(response.status);
        const body = await response.text();
        res.send(body);
    }
};
__decorate([
    All('*'),
    openapi.ApiResponse({ status: 200, type: Boolean }),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "handle", null);
AuthController = __decorate([
    Controller('api/auth'),
    Public()
], AuthController);
export { AuthController };
//# sourceMappingURL=auth.controller.js.map