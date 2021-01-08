import { matchRecursive } from 'xregexp';
import { identity } from 'ramda';

export const getDirectiveInputs = (
  matchValue,
  directiveValue,
  inputs,
  config
) =>
  inputs.map(({ name, transform, type, wrappers }) => {
    const mungedValues = wrappers.map(({ left, right }) => {
      try {
        return matchRecursive(
          matchValue,
          `${name}( |\n|\t)*:( |\n|\t)*\\${left}`,
          `\\${right}`,
          'gi'
        )[0];
      } catch (e) {
        return undefined;
      }
    });
    const index = mungedValues.findIndex(identity);
    let required = !type;
    if (type && type.getTypeDef && type.getTypeName) {
      const typeDef = type.getTypeDef(type.getTypeName(config));
      required = typeDef[typeDef.length - 1] === '!';
    }
    if (index === -1 && required) {
      throw new Error(
        `Directive ${directiveValue} expected "${name}" argument but didn't receive one.`
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
