export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export function validateEmail(email: string): ValidationResult {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isValid = emailRegex.test(email);

  return {
    isValid,
    errors: isValid ? [] : ['Invalid email format'],
  };
}

export function validateRequired(
  value: unknown,
  fieldName: string
): ValidationResult {
  const isValid = value !== null && value !== undefined && value !== '';

  return {
    isValid,
    errors: isValid ? [] : [`${fieldName} is required`],
  };
}

export function validateMinLength(
  value: string,
  minLength: number,
  fieldName: string
): ValidationResult {
  const isValid = Boolean(value && value.length >= minLength);

  return {
    isValid,
    errors: isValid
      ? []
      : [`${fieldName} must be at least ${minLength} characters`],
  };
}
