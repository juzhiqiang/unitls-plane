export interface ApiResponse<T = any> {
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
    post<T>(endpoint: string, data: any): Promise<ApiResponse<T>>;
    put<T>(endpoint: string, data: any): Promise<ApiResponse<T>>;
    delete<T>(endpoint: string): Promise<ApiResponse<T>>;
}
