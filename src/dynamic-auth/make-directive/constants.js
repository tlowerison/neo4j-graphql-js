export const toAuthorization = (statement, alias) => variableName =>
  `${statement.replace(new RegExp(alias, 'g'), variableName)}`;

export const wrappers = {
  array: [{ left: '[', right: ']' }],
  string: [
    { left: '"""', right: '"""' },
    { left: '"', right: '"' }
  ]
};
