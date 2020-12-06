import { AUTHORIZATION_NAME } from '../make-directive';
import { codifyDirectiveInstance } from './codify-directive-instance';
import {
  compose,
  has,
  fromPairs,
  keys,
  lensPath,
  multiply,
  sortBy,
  toPairs,
  uniq,
  unnest,
  view,
  zip
} from 'ramda';
import { decodifyDirectiveInstance } from './decodify-directive-instance';
import { directives } from '../make-directive';
import { getDirectiveAST } from './get-directive-ast';
import { getDirectiveInputs } from './get-directive-inputs';
import { match, valueNames } from './constants';
import { matchRecursive } from 'xregexp';

export const mungeTypeDefs = config => {
  const { typeDefs } = config;
  const directiveAST = getDirectiveAST(config);
  const customDirectives = fromPairs(
    directiveAST.map(({ name, ...rest }) => [name, rest])
  );
  const calledCustomDirectiveInstances = matchRecursive(
    typeDefs,
    '\\(',
    '\\)',
    'gi',
    { valueNames }
  );
  const calledInstances = calledCustomDirectiveInstances
    .map((calledCustomDirectiveInstance, index) => ({
      ...calledCustomDirectiveInstance,
      index
    }))
    .filter(
      ({ name, index, value }) =>
        name === 'between' &&
        has(value.slice(value.lastIndexOf('@') + 1), customDirectives) &&
        index < calledCustomDirectiveInstances.length - 3
    )
    .map(({ index, value, end }) => {
      const matchValue = calledCustomDirectiveInstances[index + 2].value;
      const directiveValue = value.slice(value.lastIndexOf('@') + 1);
      if (
        customDirectives[directiveValue].instances.filter(
          ({ name }) => name === AUTHORIZATION_NAME
        ).length === 0
      ) {
        throw new Error(
          `Cannot call @${directiveValue} because it does not implement the @${AUTHORIZATION_NAME} directive`
        );
      }
      return {
        name: directiveValue,
        start: end - (value.length - value.lastIndexOf(`@${directiveValue}`)),
        end: calledCustomDirectiveInstances[index + 3].end,
        args: fromPairs(
          unnest(
            customDirectives[directiveValue].instances.map(({ name }) =>
              zip(
                directives[name].customParams.map(({ name }) => name),
                getDirectiveInputs(
                  matchValue,
                  name,
                  directives[name].customParams
                ).map(({ value }) => value)
              )
            )
          )
        )
      };
    });

  const uncalledInstances = match(
    typeDefs,
    new RegExp(`@(${keys(customDirectives).join('|')})( |\n|\t)`, 'g')
  ).map(({ end, start, value }) => {
    const directiveValue = value.slice(1, value.length - 1);
    return {
      name: directiveValue,
      start,
      end: end - 1,
      args: {}
    };
  });

  const instances = sortBy(compose(multiply(-1), view(lensPath(['start']))), [
    ...calledInstances,
    ...uncalledInstances
  ]).map(instance => ({
    ...instance,
    code: codifyDirectiveInstance(instance)
  }));

  const slices = new Array(2 * instances.length + 1).fill('');
  let runningEnd = typeDefs.length;
  for (let i = 0; i < instances.length; i += 1) {
    const { code, end, name, start } = instances[i];
    slices[2 * i] = typeDefs.slice(end, runningEnd);
    slices[2 * i + 1] = `@${code}`;
    runningEnd = start;
  }
  slices[slices.length - 1] = typeDefs.slice(0, runningEnd);
  slices.reverse();

  const authDirectives = {
    ...fromPairs(
      uniq(instances.map(view(lensPath(['code'])))).map(code => [
        code,
        decodifyDirectiveInstance(code, customDirectives)
      ])
    ),
    ...directives
  };

  return {
    authDirectives,
    typeDefs: `${toPairs(authDirectives)
      .map(
        ([name, { locations, params = [] }]) =>
          `directive @${name}${
            params.length > 0
              ? `(${params
                  .map(({ name, type }) => `${name}: ${type.value}`)
                  .join(', ')})`
              : ''
          } on ${locations.join(' | ')}`
      )
      .join('\n')}\n\n${slices.join('')}`
  };
};
