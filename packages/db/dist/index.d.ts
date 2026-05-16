export interface User {
    id: string;
    email: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
}
export interface DatabaseConfig {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
}
export declare class Database {
    private config;
    constructor(config: DatabaseConfig);
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    findUserById(id: string): Promise<User | null>;
    createUser(userData: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User>;
}
