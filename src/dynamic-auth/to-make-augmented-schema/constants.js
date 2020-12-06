import {
  AUTHENTICATION_NAME,
  AUTHORIZATION_NAME,
  ENVIRONMENT_NAME
} from '../make-directive';
import { DirectiveLocation, GraphQLList, GraphQLString } from 'graphql';
import { addIndex, compose, groupBy, keys, values } from 'ramda';

export const directives = {
  [AUTHENTICATION_NAME]: {
    customParams: [],
    instances: [],
    locations: [
      DirectiveLocation.FIELD_DEFINITION,
      DirectiveLocation.INTERFACE,
      DirectiveLocation.OBJECT,
      DirectiveLocation.UNION
    ],
    params: [
      {
        name: 'requires',
        transform: value => value.split(',').map(role => role.trim()),
        type: {
          getDefinition: schema => {
            const RoleType = schema.getType('Role');
            if (!RoleType) {
              throw new Error('Role enum is required');
            }
            return { type: new GraphQLList(RoleType), defaultValue: 'NONE' };
          },
          value: '[Role!]!'
        },
        wrappers: [{ left: '[', right: ']' }]
      }
    ]
  },
  [AUTHORIZATION_NAME]: {
    customParams: [
      {
        name: 'this',
        wrappers: [
          { left: '"', right: '"' },
          { left: '"""', right: '"""' }
        ]
      }
    ],
    instances: [],
    locations: [
      DirectiveLocation.FIELD_DEFINITION,
      DirectiveLocation.INTERFACE,
      DirectiveLocation.OBJECT,
      DirectiveLocation.UNION
    ],
    params: [
      {
        name: 'requires',
        type: {
          getDefinition: () => ({ type: GraphQLString, defaultValue: 'FALSE' }),
          value: 'String!'
        },
        wrappers: [
          { left: '"', right: '"' },
          { left: '"""', right: '"""' }
        ]
      }
    ]
  },
  [ENVIRONMENT_NAME]: {
    customParams: [
      {
        name: 'this',
        wrappers: [
          { left: '"', right: '"' },
          { left: '"""', right: '"""' }
        ]
      }
    ],
    instances: [],
    locations: [DirectiveLocation.FIELD_DEFINITION],
    params: [
      {
        name: 'provides',
        type: {
          getDefinition: () => ({ type: GraphQLString, defaultValue: '' }),
          value: 'String!'
        },
        wrappers: [
          { left: '"', right: '"' },
          { left: '"""', right: '"""' }
        ]
      }
    ]
  }
};

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
export const space = '( |\t|\n)*';
export const directive = `(${keys(directives).join('|')})`;
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
