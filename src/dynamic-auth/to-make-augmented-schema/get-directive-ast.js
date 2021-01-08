import {
  directive,
  isDefinition,
  isValidNesting,
  nest,
  valueNames
} from './constants';
import { directives } from '../make-directive';
import { fromPairs, last, slice, zip } from 'ramda';
import { getDirectiveInputs } from './get-directive-inputs';
import { matchRecursive } from 'xregexp';

export const getDirectiveAST = config => {
  if (typeof config.config.auth.typeDefs !== 'string') {
    throw new Error('config.auth.typeDefs must be a string');
  }
  const recursiveMatches = nest(
    matchRecursive(config.config.auth.typeDefs, '\\(', '\\)', 'gi', {
      valueNames
    })
  );
  if (recursiveMatches.length === 0) return recursiveMatches;
  const lastRecursiveMatch = last(recursiveMatches);
  const canLastRecursiveMatchBeTrimmed =
    lastRecursiveMatch.length === 1 && lastRecursiveMatch[0].name === 'between';
  if (
    !(
      slice(0, -1, recursiveMatches).every(isValidNesting) &&
      (isValidNesting(lastRecursiveMatch) || canLastRecursiveMatchBeTrimmed)
    )
  ) {
    throw new Error('Bad syntax');
  }
  if (canLastRecursiveMatchBeTrimmed) {
    recursiveMatches.pop();
  }
  return mungeRecursiveMatches(recursiveMatches);
};

const mungeRecursiveMatches = recursiveMatches =>
  recursiveMatches.reduce((acc, [between, left, match, right]) => {
    let betweenValue = between.value.trim();
    betweenValue = betweenValue.slice(betweenValue.match('@').index);
    const matchValue = match.value.trim();
    if (isDefinition(betweenValue)) {
      const [nameValue, directiveValue] = betweenValue
        .split(':=')
        .map(e => e.trim().slice(1));
      if (!directiveValue.match(directive)) {
        throw new Error(`Directive ${directiveValue} is not defined.`);
      }
      return [
        ...acc,
        {
          name: nameValue,
          instances: [
            {
              name: directiveValue,
              args: fromPairs(
                zip(
                  directives[directiveValue].params.map(({ name }) => name),
                  getDirectiveInputs(
                    matchValue,
                    directiveValue,
                    directives[directiveValue].params
                  ).map(({ value }) => value)
                )
              )
            }
          ]
        }
      ];
    }
    const directiveValue = betweenValue.slice(1);
    const prev = last(acc);
    return [
      ...slice(0, -1, acc),
      {
        ...prev,
        instances: [
          ...prev.instances,
          {
            name: betweenValue.slice(1),
            args: fromPairs(
              zip(
                directives[directiveValue].params.map(({ name }) => name),
                getDirectiveInputs(
                  matchValue,
                  directiveValue,
                  directives[directiveValue].params
                ).map(({ value }) => value)
              )
            )
          }
        ]
      }
    ];
  }, []);
