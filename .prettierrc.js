/** @type {import("prettier").Config} */
module.exports = {
  // 基础格式化选项
  semi: true,
  singleQuote: true,
  quoteProps: 'as-needed',
  trailingComma: 'es5',

  // 缩进和换行
  tabWidth: 2,
  useTabs: false,
  printWidth: 80,

  // 括号和空格
  bracketSpacing: true,
  bracketSameLine: false,
  arrowParens: 'avoid',

  // 换行符
  endOfLine: 'lf',

  // 文件类型特定配置
  overrides: [
    {
      files: '*.json',
      options: {
        printWidth: 120,
      },
    },
    {
      files: '*.md',
      options: {
        printWidth: 100,
        proseWrap: 'always',
      },
    },
  ],
};
