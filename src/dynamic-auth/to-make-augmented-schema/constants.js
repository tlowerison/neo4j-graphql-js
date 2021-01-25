import { DirectiveLocation, GraphQLList, GraphQLString } from 'graphql';
import { addIndex, compose, groupBy, keys, values } from 'ramda';
import { directiveDefinitions } from '../make-directive';

export const valueNames = ['between', 'left', 'match', 'right'];
export const nest = compose(
  values,
  addIndex(groupBy)((_, i) => Math.floor(i / valueNames.length))
);
export const isValidNesting = ([between, left, match, right]) =>
  between &&
  between.name === 'between' &&
  left &&
  left.name === 'left' &&
  match &&
  match.name === 'match' &&
  right &&
  right.name === 'right';

export const alpha = '([A-Z]|[a-z]|_)';
export const alphanumeric = '([A-Z]|[a-z]|[0-9]|_)';
export const name = `${alpha}${alphanumeric}+`;
export const varName = `(\`[^\`]+\`|${alpha}${alphanumeric}*)`;
export const space = '( |\t|\n)*';
export const directive = `(${keys(directiveDefinitions).join('|')})`;
export const definition = `${space}@${name}${space}:=${space}@${directive}${space}`;
export const isDefinition = text => text.match(new RegExp(definition, 'g'));

export const match = (text, regex) => {
  let matched;
  const indices = [];
  while ((matched = regex.exec(text))) {
    indices.push({
      value: matched[0],
      start: matched.index,
      end: matched.index + matched[0].length
    });
  }
  return indices;
};
