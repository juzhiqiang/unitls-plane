export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}
export declare function validateEmail(email: string): ValidationResult;
export declare function validateRequired(
  value: unknown,
  fieldName: string
): ValidationResult;
export declare function validateMinLength(
  value: string,
  minLength: number,
  fieldName: string
): ValidationResult;
//# sourceMappingURL=index.d.ts.map
