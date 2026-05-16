export function validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isValid = emailRegex.test(email);
    return {
        isValid,
        errors: isValid ? [] : ['Invalid email format']
    };
}
export function validateRequired(value, fieldName) {
    const isValid = value !== null && value !== undefined && value !== '';
    return {
        isValid,
        errors: isValid ? [] : [`${fieldName} is required`]
    };
}
export function validateMinLength(value, minLength, fieldName) {
    const isValid = Boolean(value && value.length >= minLength);
    return {
        isValid,
        errors: isValid ? [] : [`${fieldName} must be at least ${minLength} characters`]
    };
}
