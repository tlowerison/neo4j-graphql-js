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
import { directiveDefinitions } from '../make-directive';
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
        !customDirectives[directiveValue].instances.some(
          ({ name }) => directiveDefinitions[name].customParams?.length > 0
        )
      ) {
        throw new Error(
          `Cannot call @${directiveValue}, none of the directiveDefinitions it implements have custom parameters`
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
                directiveDefinitions[name].customParams.map(({ name }) => name),
                getDirectiveInputs(
                  matchValue,
                  name,
                  directiveDefinitions[name].customParams,
                  config
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
    ...directiveDefinitions
  };

  return {
    authDirectives,
    typeDefs: `${slices.join('')}\n\n${toPairs(authDirectives)
      .map(
        ([directiveName, { locations, params = [] }]) =>
          `directive @${directiveName}${
            params.length > 0
              ? `(${params
                  .map(({ name, type }) => {
                    const { getTypeDef, getTypeName } =
                      directiveDefinitions[directiveName]?.params?.find(
                        param => param.name === name
                      )?.type || {};
                    if (getTypeDef && getTypeName) {
                      return `${name}: ${getTypeDef(getTypeName(config))}`;
                    }
                    return `${name}: ${type.value}`;
                  })
                  .join(', ')})`
              : ''
          } on ${locations.join(' | ')}`
      )
      .join('\n')}`
  };
};
