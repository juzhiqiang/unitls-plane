export function formatDate(date) {
  return date.toISOString().split('T')[0] || '';
}
export function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
export function debounce(func, wait) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}
//# sourceMappingURL=index.js.map
