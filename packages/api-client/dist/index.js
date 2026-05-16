export class ApiClient {
    constructor(baseUrl = 'http://localhost:3001') {
        this.baseUrl = baseUrl;
    }
    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        try {
            const response = await fetch(url, {
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers,
                },
                ...options,
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || 'API request failed');
            }
            return data;
        }
        catch (error) {
            throw {
                message: error instanceof Error ? error.message : 'Unknown error',
                status: 500,
            };
        }
    }
    async get(endpoint) {
        return this.request(endpoint, { method: 'GET' });
    }
    async post(endpoint, data) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }
    async put(endpoint, data) {
        return this.request(endpoint, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }
    async delete(endpoint) {
        return this.request(endpoint, { method: 'DELETE' });
    }
}
