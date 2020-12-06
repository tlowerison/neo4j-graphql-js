export const toArgString = (argString, { inProcedure = true, varNames = [] }) =>
  `{${varNames.reduce(
    (acc, varName, i) =>
      `${acc}${varName}:${inProcedure ? '$' : ''}${varName}${
        i < varNames.length - 1 ? ', ' : ''
      }`,
    ''
  )}${argString ? `, ${argString.slice(1, argString.length - 1)}` : ''}}`;
