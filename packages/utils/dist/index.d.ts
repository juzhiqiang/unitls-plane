export declare function formatDate(date: Date): string;
export declare function capitalize(str: string): string;
export declare function debounce<T extends (...args: any[]) => any>(func: T, wait: number): (...args: Parameters<T>) => void;
