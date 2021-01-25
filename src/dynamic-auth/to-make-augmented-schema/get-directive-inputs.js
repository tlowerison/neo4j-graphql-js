import { matchRecursive } from 'xregexp';
import { identity } from 'ramda';

const space = `( |\\n|\\t)*`;
const options = { valueNames: ['between', 'left', 'match', 'right'] };

export const getDirectiveInputs = (
  matchValue,
  directiveValue,
  inputs,
  config
) => {
  const trimmedMatchValue = matchValue.trim();
  const names = `(${inputs.map(({ name }) => name).join('|')})`;
  return inputs.map(({ name, transform, type, wrappers }) => {
    let mungedMatchValue = trimmedMatchValue;
    const mungedValues = [];
    for (let i = 0; i < wrappers.length; i += 1) {
      const { left, right } = wrappers[i];
      const escapedLeft = left
        .split('')
        .map(char => `\\${char}`)
        .join('');
      const escapedRight = right
        .split('')
        .map(char => `\\${char}`)
        .join('');
      const leftDelimiter = `${names}:${space}${escapedLeft}(?!${escapedLeft.slice(
        0,
        2
      )})`;
      let rightDelimiter = `(?<!:${space})${escapedRight}(?!${escapedRight.slice(
        0,
        2
      )})`;
      rightDelimiter = `(${rightDelimiter}$|${rightDelimiter},${space}$|${rightDelimiter},(?=${space}${names}:))`;
      let results = [];
      try {
        results = matchRecursive(
          mungedMatchValue,
          leftDelimiter,
          rightDelimiter,
          'gi',
          options
        );
      } catch (e) {
        results = [{ name: 'between', value: mungedMatchValue }];
      }
      const firstLeftIndex = results.find(({ name }) => name === 'left');
      if (firstLeftIndex !== -1) {
        const specificLeftDelimiter = `${name}:( |\n|\t)*${escapedLeft}(?!${escapedLeft.slice(
          0,
          2
        )})`;
        const matchesName = left =>
          left.match(new RegExp(`^${specificLeftDelimiter}$`));
        mungedValues.push(
          ...results
            .filter(
              ({ name }, i) =>
                name === 'match' && matchesName(results[i - 1].value)
            )
            .map(({ value }) => value)
        );
        mungedMatchValue = results
          .filter(({ name }) => name === 'between')
          .map(({ value }) => value)
          .join(' ');
      }
    }
    const index = mungedValues.findIndex(identity);
    let required = !type;
    if (type && type.getTypeDef && type.getTypeName) {
      const typeDef = type.getTypeDef(type.getTypeName(config));
      required = typeDef[typeDef.length - 1] === '!';
    }
    if (index === -1 && required) {
      throw new Error(
        `Directive @${directiveValue} either received unknown arguments or is missing required arguments.\n\n${`@${directiveValue}(\n${matchValue}\n)`
          .split('\n')
          .map(line => `  ${line}`)
          .join('\n')}\n`
      );
    } else if (index === -1 && !required) {
      return { name, value: type.defaultValue };
    }
    let value = mungedValues[index]
      .replace(new RegExp('( |\t|\n)+', 'g'), ' ')
      .trim();
    if (transform) {
      value = transform(value);
    }
    return { name, value };
  });
};
