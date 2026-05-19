export interface ApiResponse<T = unknown> {
    data: T;
    success: boolean;
    message?: string;
}
export interface ApiError {
    message: string;
    status: number;
    code?: string;
}
export declare class ApiClient {
    private baseUrl;
    constructor(baseUrl?: string);
    private request;
    get<T>(endpoint: string): Promise<ApiResponse<T>>;
    post<T>(endpoint: string, data: unknown): Promise<ApiResponse<T>>;
    put<T>(endpoint: string, data: unknown): Promise<ApiResponse<T>>;
    delete<T>(endpoint: string): Promise<ApiResponse<T>>;
}
//# sourceMappingURL=index.d.ts.map